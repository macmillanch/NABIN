'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import ConsoleLayout from '@/components/ConsoleLayout';
import {
  AlertCircleIcon,
  ArrowRightIcon,
  CheckCircleIcon,
  ClockIcon,
  PinIcon,
  RefreshIcon,
  ShoppingBagIcon,
  UserIcon,
  UtensilsIcon,
} from '@/components/Icons';
import { useMerchant } from '@/context/MerchantAuth';
import { merchantApi, type MerchantOrder, type OrderLine } from '@/lib/api';
import { dateTime, inr, toFailure } from '@/lib/format';
import {
  MERCHANT_ACTIONS,
  REJECTION_REASONS,
  STATE_TONE,
  humanise,
  linesOf,
  prettyReason,
  type MerchantAction,
} from '@/lib/orderFlow';

const FILTERS = ['OPEN', 'RECEIVED', 'ACCEPTED', 'PREPARING', 'PACKING', 'READY_FOR_PICKUP', 'ALL'];
const OPEN_STATES = ['RECEIVED', 'ACCEPTED', 'PREPARING', 'PACKING', 'READY_FOR_PICKUP'];
const POLL_MS = 15000;

export const DEMO_ORDERS: MerchantOrder[] = [
  {
    id: 'demo-order-food-01',
    order_number: 'NAB-FD-8942',
    service_type: 'FOOD',
    order_state: 'RECEIVED',
    total_amount: 480,
    created_at: new Date(Date.now() - 12 * 60 * 1000).toISOString(),
    metadata: {
      customerName: 'Lalrinfela',
      deliveryAddress: 'Bawngkawn, near Presbyterian Church, Aizawl',
      deliveryInstructions: 'Call upon arrival; gate code is 1234',
    },
    lines: [
      {
        id: 'line-f1',
        product_name_snapshot: 'Vawksa Rep Chhum (Smoked Pork Soup)',
        quantity: 2,
        unit_price_snapshot: 190,
        line_total: 380,
      },
      {
        id: 'line-f2',
        product_name_snapshot: 'Steamed Local Rice & Bai',
        quantity: 1,
        unit_price_snapshot: 100,
        line_total: 100,
      },
    ],
  },
  {
    id: 'demo-order-groc-02',
    order_number: 'NAB-GR-5021',
    service_type: 'GROCERY',
    order_state: 'PACKING',
    total_amount: 865,
    created_at: new Date(Date.now() - 25 * 60 * 1000).toISOString(),
    metadata: {
      customerName: 'Zonunmawii',
      deliveryAddress: 'Zarkawt Main Road, House No. 42, Aizawl',
      deliveryInstructions: 'Please leave with security if not answering.',
    },
    lines: [
      {
        id: 'line-g1',
        product_name_snapshot: 'Miniket Rice (5kg Bag)',
        quantity: 1,
        unit_snapshot: 'bag',
        unit_price_snapshot: 420,
        line_total: 420,
        packed_confirmed_quantity: 1,
      },
      {
        id: 'line-g2',
        product_name_snapshot: 'Organic Local Ginger (Adrak)',
        quantity: 0.5,
        unit_snapshot: 'kg',
        unit_price_snapshot: 120,
        line_total: 60,
        packed_confirmed_quantity: 0.52,
      },
      {
        id: 'line-g3',
        product_name_snapshot: 'Farm Fresh Eggs (1 Dozen)',
        quantity: 2,
        unit_snapshot: 'pack',
        unit_price_snapshot: 140,
        line_total: 280,
      },
    ],
  },
  {
    id: 'demo-order-food-03',
    order_number: 'NAB-FD-8945',
    service_type: 'FOOD',
    order_state: 'PREPARING',
    total_amount: 540,
    created_at: new Date(Date.now() - 35 * 60 * 1000).toISOString(),
    metadata: {
      customerName: 'Vanlalruata',
      deliveryAddress: 'Tuikual South, Near Community Hall, Aizawl',
      deliveryInstructions: 'Ring bell twice, keep food warm please',
    },
    lines: [
      {
        id: 'line-f3',
        product_name_snapshot: 'Smoked Beef Curry with Bamboo Shoot',
        quantity: 1,
        unit_price_snapshot: 320,
        line_total: 320,
      },
      {
        id: 'line-f4',
        product_name_snapshot: 'Crispy Fried Momos (8 pcs)',
        quantity: 1,
        unit_price_snapshot: 140,
        line_total: 140,
      },
      {
        id: 'line-f5',
        product_name_snapshot: 'Chhangban (Steamed Rice Bread)',
        quantity: 2,
        unit_price_snapshot: 40,
        line_total: 80,
      },
    ],
  },
  {
    id: 'demo-order-groc-04',
    order_number: 'NAB-GR-5028',
    service_type: 'GROCERY',
    order_state: 'READY_FOR_PICKUP',
    total_amount: 1120,
    created_at: new Date(Date.now() - 48 * 60 * 1000).toISOString(),
    metadata: {
      customerName: 'Malsawmtluanga',
      deliveryAddress: 'Mission Veng, Street 3, Aizawl',
    },
    lines: [
      {
        id: 'line-g4',
        product_name_snapshot: 'Aashirvaad Atta 10kg',
        quantity: 1,
        unit_snapshot: 'bag',
        unit_price_snapshot: 485,
        line_total: 485,
        packed_confirmed_quantity: 1,
      },
      {
        id: 'line-g5',
        product_name_snapshot: 'Amul Pure Ghee 1L',
        quantity: 1,
        unit_snapshot: 'tin',
        unit_price_snapshot: 635,
        line_total: 635,
        packed_confirmed_quantity: 1,
      },
    ],
  },
  {
    id: 'demo-order-food-05',
    order_number: 'NAB-FD-8949',
    service_type: 'FOOD',
    order_state: 'READY_FOR_PICKUP',
    total_amount: 360,
    created_at: new Date(Date.now() - 55 * 60 * 1000).toISOString(),
    metadata: {
      customerName: 'Hmingthanzuala',
      deliveryAddress: 'Khatla South, Near PHED Office, Aizawl',
    },
    lines: [
      {
        id: 'line-f6',
        product_name_snapshot: 'Spicy Pork Ribs Fry',
        quantity: 1,
        unit_price_snapshot: 260,
        line_total: 260,
      },
      {
        id: 'line-f7',
        product_name_snapshot: 'Local Lemon Iced Tea',
        quantity: 2,
        unit_price_snapshot: 50,
        line_total: 100,
      },
    ],
  },
];

export default function OrdersPage() {
  const { merchant, loading, activeContext } = useMerchant();
  const router = useRouter();

  const [filter, setFilter] = useState('OPEN');
  const [orders, setOrders] = useState<MerchantOrder[]>([]);
  const [pending, setPending] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busyId, setBusyId] = useState('');
  const [rejectingId, setRejectingId] = useState('');
  const [reason, setReason] = useState(REJECTION_REASONS[0]);
  const [weights, setWeights] = useState<Record<string, string>>({});
  const [selectedOrder, setSelectedOrder] = useState<MerchantOrder | null>(null);
  const [useDemoFallback, setUseDemoFallback] = useState(true);

  // Keyboard accessibility and body scroll lock for modal
  useEffect(() => {
    if (!selectedOrder) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSelectedOrder(null);
      }
    };
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = '';
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [selectedOrder]);

  const load = useCallback(
    async (silent = false) => {
      if (!merchant?.id) return;
      if (!silent) setPending(true);
      try {
        const status = filter === 'ALL' || filter === 'OPEN' ? undefined : filter;
        const res = await merchantApi.orders(status);
        const all: MerchantOrder[] = res.data.orders ?? [];

        // Filter based on activeContext
        const scoped =
          activeContext === 'RESTAURANT'
            ? all.filter((o) => o.service_type === 'FOOD')
            : activeContext === 'GROCERY'
              ? all.filter((o) => o.service_type === 'GROCERY')
              : all;

        if (scoped.length > 0) {
          setOrders(filter === 'OPEN' ? scoped.filter((o) => OPEN_STATES.includes(o.order_state)) : scoped);
          setUseDemoFallback(false);
        } else if (useDemoFallback) {
          const demoScoped =
            activeContext === 'RESTAURANT'
              ? DEMO_ORDERS.filter((o) => o.service_type === 'FOOD')
              : activeContext === 'GROCERY'
                ? DEMO_ORDERS.filter((o) => o.service_type === 'GROCERY')
                : DEMO_ORDERS;
          setOrders(filter === 'OPEN' ? demoScoped.filter((o) => OPEN_STATES.includes(o.order_state)) : demoScoped);
        } else {
          setOrders([]);
        }
        setError('');
      } catch (err) {
        setError(toFailure(err, 'Could not load the live order queue.').message);
        if (useDemoFallback) {
          const demoScoped =
            activeContext === 'RESTAURANT'
              ? DEMO_ORDERS.filter((o) => o.service_type === 'FOOD')
              : activeContext === 'GROCERY'
                ? DEMO_ORDERS.filter((o) => o.service_type === 'GROCERY')
                : DEMO_ORDERS;
          setOrders(filter === 'OPEN' ? demoScoped.filter((o) => OPEN_STATES.includes(o.order_state)) : demoScoped);
        }
      } finally {
        setPending(false);
      }
    },
    [merchant?.id, filter, activeContext, useDemoFallback],
  );

  useEffect(() => {
    if (!loading && !merchant) router.replace('/login');
  }, [loading, merchant, router]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    const timer = setInterval(() => load(true), POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  const applyAction = async (order: MerchantOrder, action: MerchantAction) => {
    setBusyId(`${order.id}:${action.status}`);
    setError('');

    // Demo safety guard: never invoke real backend API for demo orders
    if (order.id.startsWith('demo-')) {
      setOrders((prev) =>
        prev.map((o) =>
          o.id === order.id
            ? { ...o, order_state: action.status }
            : o
        )
      );
      setNotice(`[Demo Mode] Simulated status transition to "${action.label}". Server data remained unmodified.`);
      setRejectingId('');
      setBusyId('');
      return;
    }

    try {
      await merchantApi.setOrderStatus(
        order.id,
        action.status,
        action.status === 'REJECTED' ? reason : undefined,
      );
      setRejectingId('');
      await load(true);
    } catch (err) {
      setError(toFailure(err, 'That status change was rejected by the order state machine.').message);
    } finally {
      setBusyId('');
    }
  };

  const submitWeight = async (order: MerchantOrder, line: OrderLine) => {
    const lineId = line.id ?? line.grocery_inventory_id;
    const value = weights[lineId ?? ''];
    if (!lineId || !value) return;
    setBusyId(`weight:${lineId}`);
    setError('');
    setNotice('');

    // Demo safety guard: never invoke real backend API for demo orders
    if (order.id.startsWith('demo-')) {
      setOrders((prev) =>
        prev.map((o) => {
          if (o.id !== order.id) return o;
          const updatedLines = (o.lines || []).map((l) =>
            (l.id === lineId || l.grocery_inventory_id === lineId)
              ? { ...l, packed_confirmed_quantity: Number(value) }
              : l
          );
          return { ...o, lines: updatedLines };
        })
      );
      setNotice(`[Demo Mode] Recorded packed weight ${value} ${line.unit_snapshot ?? 'unit'}. Server data remained unmodified.`);
      setBusyId('');
      return;
    }

    try {
      await merchantApi.setPackedWeight(order.id, lineId, Number(value));
      setNotice(
        `${line.product_name_snapshot}: packed ${value} ${line.unit_snapshot ?? 'unit'} recorded.`,
      );
      await load(true);
    } catch (err) {
      setError(
        toFailure(err, 'The packed weight was refused — it cannot exceed the ordered quantity.').message,
      );
    } finally {
      setBusyId('');
    }
  };

  if (loading || !merchant) {
    return <div className="nabin-skeleton" style={{ minHeight: '100vh', border: 'none' }} />;
  }

  return (
    <ConsoleLayout title="Order Queue">
      <div className="nabin-stack">
        <div className="nabin-page-head" style={{ marginBottom: 0 }}>
          <div>
            <h1 className="nabin-visually-hidden">Order Queue</h1>
            <p>
              Auto-refreshes every {POLL_MS / 1000} seconds. Status updates follow NABIN’s server-side
              order lifecycle.
            </p>
          </div>
          <button onClick={() => load()} className="nabin-btn nabin-btn--ghost" style={{ minHeight: 40 }}>
            <RefreshIcon />
            <span>Refresh</span>
          </button>
        </div>

        {error && (
          <div className="nabin-alert nabin-alert--danger" role="alert">
            <span>{error}</span>
          </div>
        )}
        {notice && (
          <div className="nabin-alert nabin-alert--success" role="alert">
            <span>{notice}</span>
          </div>
        )}

        {/* Filter Toolbar with Modern Pill Bar */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-md)', flexWrap: 'wrap' }}>
          <div className="nabin-filter-pill-bar" role="tablist" aria-label="Order filters">
            {FILTERS.map((item) => {
              const active = filter === item;
              return (
                <button
                  key={item}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  className={`nabin-filter-pill ${active ? 'nabin-filter-pill--active' : ''}`}
                  onClick={() => setFilter(item)}
                >
                  <span>{humanise(item)}</span>
                  {active && <span className="nabin-filter-pill__count">{orders.length}</span>}
                </button>
              );
            })}
          </div>
          <span className="nabin-cell-meta" style={{ fontSize: 13, fontWeight: 600 }}>
            {orders.length} order{orders.length === 1 ? '' : 's'} in queue
          </span>
        </div>

        {/* Order Cards List */}
        {orders.length === 0 ? (
          <div className="nabin-empty">
            <p>{pending ? 'Loading orders…' : 'No orders in this queue right now.'}</p>
            {!pending && !useDemoFallback && (
              <button
                type="button"
                className="nabin-btn nabin-btn--ghost"
                style={{ marginTop: 'var(--space-md)' }}
                onClick={() => {
                  setUseDemoFallback(true);
                  setNotice('Displaying demo order queue for visual review.');
                }}
              >
                Preview Demo Orders
              </button>
            )}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
            {useDemoFallback && (
              <div
                className="nabin-card"
                style={{
                  padding: '12px 18px',
                  background: 'linear-gradient(90deg, #eff6ff 0%, #f8fafc 100%)',
                  border: '1px solid #bfdbfe',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 'var(--space-md)',
                  flexWrap: 'wrap',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span className="nabin-badge nabin-badge--brand" style={{ fontSize: 11 }}>Demo Mode</span>
                  <span style={{ fontSize: 13, color: 'var(--ink)' }}>
                    Viewing realistic demo orders for UI validation. Order transitions are safely simulated in memory.
                  </span>
                </div>
                <span style={{ fontSize: 12, color: 'var(--ink-muted)', fontWeight: 600 }}>
                  Active Context: {activeContext}
                </span>
              </div>
            )}
            {orders.map((order) => {
              const lines = linesOf(order);
              const actions = MERCHANT_ACTIONS[order.order_state] ?? [];
              const isFood = order.service_type === 'FOOD';
              const isGrocery = order.service_type === 'GROCERY';
              const stateClass = order.order_state.toLowerCase().replace(/_/g, '-');

              return (
                <article key={order.id} className={`nabin-order-ticket nabin-order-ticket--${stateClass}`}>
                  <header className="nabin-order-ticket__header">
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 18, fontWeight: 800, letterSpacing: '-0.02em', color: 'var(--ink)' }}>
                          {order.order_number}
                        </span>
                        {order.id.startsWith('demo-') && (
                          <span className="nabin-badge nabin-badge--warning" style={{ fontSize: 11, padding: '2px 8px' }}>
                            Demo Preview
                          </span>
                        )}
                        <span
                          className={`nabin-badge ${isFood ? 'nabin-badge--warning' : 'nabin-badge--success'}`}
                          style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
                        >
                          {isFood ? <UtensilsIcon size={12} /> : <ShoppingBagIcon size={12} />}
                          <span>{isFood ? 'Kitchen Order' : 'Grocery Pick & Pack'}</span>
                        </span>
                        <span
                          className={`nabin-badge nabin-badge--${
                            STATE_TONE[order.order_state] ?? 'neutral'
                          }`}
                        >
                          {humanise(order.order_state)}
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
                          <ClockIcon size={14} />
                          <span>{dateTime(order.created_at)}</span>
                        </span>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          <UserIcon size={14} />
                          <span>{order.metadata?.customerName || 'Customer'}</span>
                        </span>
                        {order.metadata?.deliveryAddress && (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            <PinIcon size={14} />
                            <span>{order.metadata.deliveryAddress}</span>
                          </span>
                        )}
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                      <div style={{ textAlign: 'right' }}>
                        <span className="nabin-cell-meta" style={{ fontSize: 11, textTransform: 'uppercase' }}>
                          Order Total
                        </span>
                        <div style={{ fontSize: 19, fontWeight: 900, color: 'var(--ink)' }}>
                          {inr(order.total_amount)}
                        </div>
                      </div>
                      <button
                        type="button"
                        data-testid="order-details-btn"
                        onClick={() => setSelectedOrder(order)}
                        className="nabin-btn nabin-btn--ghost"
                        style={{ minHeight: 36, padding: '0 12px', fontSize: 13, gap: 4 }}
                      >
                        <span>Details</span>
                        <ArrowRightIcon size={14} />
                      </button>
                    </div>
                  </header>

                  {order.metadata?.deliveryInstructions && (
                    <div
                      style={{
                        margin: '12px 20px 0',
                        padding: '8px 12px',
                        background: '#fffbeb',
                        border: '1px solid #fef3c7',
                        borderRadius: 8,
                        fontSize: 12,
                        color: '#92400e',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                      }}
                    >
                      <span>📝 Instructions: {order.metadata.deliveryInstructions}</span>
                    </div>
                  )}

                  {/* Order Line Items */}
                  <div className="nabin-order-ticket__body" style={{ paddingTop: 12, paddingBottom: 12 }}>
                    <div className="nabin-table-wrap">
                      <table className="nabin-table">
                        <thead>
                          <tr>
                            <th>Item Name</th>
                            <th style={{ textAlign: 'right' }}>Qty</th>
                            <th style={{ textAlign: 'right' }}>Unit Price</th>
                            <th style={{ textAlign: 'right' }}>Total</th>
                            {isGrocery && order.order_state === 'PACKING' && (
                              <th style={{ textAlign: 'right' }}>Packed Weight</th>
                            )}
                          </tr>
                        </thead>
                        <tbody>
                          {lines.map((line, idx) => {
                            const lineKey = line.id ?? line.grocery_inventory_id ?? String(idx);
                            const hasPackedWeight =
                              line.packed_confirmed_quantity !== undefined &&
                              line.packed_confirmed_quantity !== null;

                            return (
                              <tr key={lineKey}>
                                <td style={{ fontWeight: 600 }}>
                                  {line.product_name_snapshot ?? 'Item'}
                                </td>
                                <td style={{ textAlign: 'right' }}>
                                  <span
                                    style={{
                                      display: 'inline-block',
                                      padding: '2px 8px',
                                      borderRadius: 6,
                                      background: 'var(--surface-muted)',
                                      fontSize: 12,
                                      fontWeight: 700,
                                    }}
                                  >
                                    {line.quantity ?? 1} {line.unit_snapshot ?? ''}
                                  </span>
                                </td>
                                <td style={{ textAlign: 'right' }}>
                                  {inr(line.unit_price_snapshot ?? 0)}
                                </td>
                                <td style={{ textAlign: 'right', fontWeight: 800 }}>
                                  {inr(line.line_total ?? 0)}
                                </td>
                                {isGrocery && order.order_state === 'PACKING' && (
                                  <td style={{ textAlign: 'right' }}>
                                    <div
                                      style={{
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: 6,
                                      }}
                                    >
                                      <input
                                        type="number"
                                        step="0.01"
                                        min="0"
                                        className="nabin-input"
                                        style={{ width: 84, minHeight: 32, padding: '2px 8px', textAlign: 'right' }}
                                        placeholder={String(line.quantity ?? 1)}
                                        value={weights[lineKey] ?? (hasPackedWeight ? String(line.packed_confirmed_quantity) : '')}
                                        onChange={(e) =>
                                          setWeights({ ...weights, [lineKey]: e.target.value })
                                        }
                                        disabled={busyId.startsWith('weight:')}
                                      />
                                      <button
                                        type="button"
                                        className="nabin-btn nabin-btn--primary"
                                        style={{ minHeight: 32, padding: '0 8px', fontSize: 12 }}
                                        disabled={!weights[lineKey] || busyId.startsWith('weight:')}
                                        onClick={() => submitWeight(order, line)}
                                      >
                                        Save
                                      </button>
                                    </div>
                                  </td>
                                )}
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Operational Status Change Actions */}
                  {actions.length > 0 && (
                    <footer className="nabin-order-ticket__footer">
                      {rejectingId === order.id ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
                          <select
                            className="nabin-select"
                            value={reason}
                            onChange={(e) => setReason(e.target.value)}
                            disabled={Boolean(busyId)}
                          >
                            {REJECTION_REASONS.map((r) => (
                              <option key={r} value={r}>
                                {prettyReason(r)}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            className="nabin-btn nabin-btn--danger"
                            onClick={() =>
                              applyAction(order, {
                                status: 'REJECTED',
                                label: 'Confirm Reject',
                                tone: 'danger',
                              })
                            }
                            disabled={Boolean(busyId)}
                          >
                            {busyId === `${order.id}:REJECTED` ? 'Rejecting…' : 'Confirm'}
                          </button>
                          <button
                            type="button"
                            className="nabin-btn nabin-btn--ghost"
                            onClick={() => setRejectingId('')}
                            disabled={Boolean(busyId)}
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        actions.map((act) => {
                          const isBusy = busyId === `${order.id}:${act.status}`;
                          if (act.status === 'REJECTED') {
                            return (
                              <button
                                key={act.status}
                                type="button"
                                className="nabin-btn nabin-btn--danger"
                                style={{ minHeight: 38 }}
                                onClick={() => setRejectingId(order.id)}
                                disabled={Boolean(busyId)}
                              >
                                {act.label}
                              </button>
                            );
                          }
                          return (
                            <button
                              key={act.status}
                              type="button"
                              className="nabin-btn nabin-btn--primary"
                              style={{ minHeight: 38, padding: '0 18px', fontWeight: 700 }}
                              onClick={() => applyAction(order, act)}
                              disabled={Boolean(busyId)}
                            >
                              {isBusy ? 'Updating…' : act.label}
                            </button>
                          );
                        })
                      )}
                    </footer>
                  )}
                </article>
              );
            })}
          </div>
        )}

        {/* Order Details Drawer / Modal with Linear Stepper */}
        {selectedOrder && (
          <div
            className="nabin-scrim--modal"
            onClick={() => setSelectedOrder(null)}
            role="dialog"
            aria-modal="true"
            aria-labelledby="order-detail-title"
          >
            <div
              className="nabin-modal"
              style={{ width: 'min(680px, 100%)', maxHeight: '90vh', overflowY: 'auto' }}
              onClick={(e) => e.stopPropagation()}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'flex-start',
                  marginBottom: 'var(--space-md)',
                  borderBottom: '1px solid var(--divider)',
                  paddingBottom: 'var(--space-md)',
                }}
              >
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <h2 id="order-detail-title" style={{ fontSize: 20, fontWeight: 900, color: 'var(--ink)' }}>
                      {selectedOrder.order_number}
                    </h2>
                    {selectedOrder.id.startsWith('demo-') && (
                      <span className="nabin-badge nabin-badge--warning" style={{ fontSize: 11 }}>Demo Preview</span>
                    )}
                    <span
                      className={`nabin-badge ${
                        selectedOrder.service_type === 'FOOD'
                          ? 'nabin-badge--warning'
                          : 'nabin-badge--success'
                      }`}
                    >
                      {selectedOrder.service_type === 'FOOD' ? '🍽️ Food' : '🛒 Grocery'}
                    </span>
                    <span
                      className={`nabin-badge nabin-badge--${
                        STATE_TONE[selectedOrder.order_state] ?? 'neutral'
                      }`}
                    >
                      {humanise(selectedOrder.order_state)}
                    </span>
                  </div>
                  <p className="nabin-cell-meta" style={{ marginTop: 4 }}>
                    Placed on {dateTime(selectedOrder.created_at)}
                  </p>
                </div>
                <button
                  type="button"
                  className="nabin-btn nabin-btn--ghost"
                  style={{ minHeight: 32, minWidth: 32, padding: 0 }}
                  onClick={() => setSelectedOrder(null)}
                  aria-label="Close order details"
                >
                  ✕
                </button>
              </div>

              {/* Linear Timeline Stepper */}
              <div style={{ marginBottom: 'var(--space-lg)' }}>
                <div className="nabin-stepper">
                  {['RECEIVED', 'ACCEPTED', selectedOrder.service_type === 'FOOD' ? 'PREPARING' : 'PACKING', 'READY_FOR_PICKUP'].map((stepState, index) => {
                    const stepOrder = ['RECEIVED', 'ACCEPTED', selectedOrder.service_type === 'FOOD' ? 'PREPARING' : 'PACKING', 'READY_FOR_PICKUP'];
                    const currentIndex = stepOrder.indexOf(selectedOrder.order_state);
                    const isDone = currentIndex > index || selectedOrder.order_state === 'READY_FOR_PICKUP';
                    const isActive = currentIndex === index;

                    return (
                      <div
                        key={stepState}
                        className={`nabin-stepper__step ${isDone ? 'nabin-stepper__step--done' : ''} ${isActive ? 'nabin-stepper__step--active' : ''}`}
                      >
                        <div className="nabin-stepper__dot">
                          {isDone ? '✓' : index + 1}
                        </div>
                        <span className="nabin-stepper__label">
                          {humanise(stepState)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Customer & Delivery Section */}
              <div
                style={{
                  background: 'var(--surface-muted)',
                  borderRadius: 'var(--radius-md)',
                  padding: 'var(--space-md)',
                  marginBottom: 'var(--space-md)',
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                  gap: 'var(--space-md)',
                  border: '1px solid var(--divider)',
                }}
              >
                <div>
                  <span className="nabin-label" style={{ fontSize: 11, textTransform: 'uppercase', color: 'var(--ink-muted)' }}>
                    Customer Contact
                  </span>
                  <div style={{ fontWeight: 800, fontSize: 15, color: 'var(--ink)', marginTop: 2 }}>
                    {selectedOrder.metadata?.customerName || 'Verified Customer'}
                  </div>
                  <div className="nabin-cell-meta" style={{ marginTop: 2 }}>Prepaid / In-App Order</div>
                </div>
                <div>
                  <span className="nabin-label" style={{ fontSize: 11, textTransform: 'uppercase', color: 'var(--ink-muted)' }}>
                    Delivery Destination
                  </span>
                  <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)', marginTop: 2 }}>
                    {selectedOrder.metadata?.deliveryAddress || 'Delivery destination on map'}
                  </div>
                  {selectedOrder.metadata?.deliveryInstructions && (
                    <div
                      style={{
                        marginTop: 6,
                        fontSize: 12,
                        color: '#92400e',
                        background: '#fffbeb',
                        padding: '4px 8px',
                        borderRadius: 'var(--radius-sm)',
                        border: '1px solid #fef3c7',
                      }}
                    >
                      📝 Note: {selectedOrder.metadata.deliveryInstructions}
                    </div>
                  )}
                </div>
              </div>

              {/* Itemized Line Items Table */}
              <div style={{ marginBottom: 'var(--space-md)' }}>
                <span className="nabin-label" style={{ marginBottom: 'var(--space-xs)', display: 'block', fontWeight: 700 }}>
                  Ordered Items ({linesOf(selectedOrder).length})
                </span>
                <div className="nabin-table-wrap">
                  <table className="nabin-table">
                    <thead>
                      <tr>
                        <th>Item</th>
                        <th style={{ textAlign: 'right' }}>Quantity</th>
                        <th style={{ textAlign: 'right' }}>Unit Price</th>
                        <th style={{ textAlign: 'right' }}>Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {linesOf(selectedOrder).map((line, idx) => (
                        <tr key={line.id || idx}>
                          <td style={{ fontWeight: 600 }}>{line.product_name_snapshot ?? 'Item'}</td>
                          <td style={{ textAlign: 'right' }}>
                            <span
                              style={{
                                display: 'inline-block',
                                padding: '2px 8px',
                                borderRadius: 6,
                                background: 'var(--surface-muted)',
                                fontSize: 12,
                                fontWeight: 700,
                              }}
                            >
                              {line.quantity ?? 1} {line.unit_snapshot ?? ''}
                            </span>
                          </td>
                          <td style={{ textAlign: 'right' }}>{inr(line.unit_price_snapshot ?? 0)}</td>
                          <td style={{ textAlign: 'right', fontWeight: 800 }}>
                            {inr(line.line_total ?? 0)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Bill Summary */}
              <div
                style={{
                  borderTop: '1px solid var(--divider)',
                  paddingTop: 'var(--space-sm)',
                  marginBottom: 'var(--space-md)',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    fontSize: 14,
                    padding: '2px 0',
                    color: 'var(--ink-muted)',
                  }}
                >
                  <span>Item Subtotal</span>
                  <span>{inr(selectedOrder.total_amount)}</span>
                </div>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    fontSize: 14,
                    padding: '2px 0',
                    color: 'var(--ink-muted)',
                  }}
                >
                  <span>Restaurant/Store Packaging & Taxes</span>
                  <span>Included</span>
                </div>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    fontSize: 16,
                    fontWeight: 900,
                    padding: '6px 0',
                    borderTop: '1px dashed var(--divider)',
                    marginTop: 4,
                  }}
                >
                  <span>Total Order Payable</span>
                  <span style={{ color: 'var(--brand)' }}>{inr(selectedOrder.total_amount)}</span>
                </div>
              </div>

              {/* Actions Footer inside Modal */}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'flex-end',
                  gap: 'var(--space-sm)',
                  borderTop: '1px solid var(--divider)',
                  paddingTop: 'var(--space-md)',
                }}
              >
                <button
                  type="button"
                  className="nabin-btn nabin-btn--ghost"
                  onClick={() => setSelectedOrder(null)}
                >
                  Close
                </button>
                {(MERCHANT_ACTIONS[selectedOrder.order_state] ?? []).map((act) => (
                  <button
                    key={act.status}
                    type="button"
                    className={`nabin-btn ${
                      act.status === 'REJECTED' ? 'nabin-btn--danger' : 'nabin-btn--primary'
                    }`}
                    style={{ fontWeight: 700 }}
                    onClick={() => {
                      if (selectedOrder.id.startsWith('demo-')) {
                        setSelectedOrder({ ...selectedOrder, order_state: act.status });
                        setNotice(`Demo order updated to ${act.label}`);
                      } else {
                        applyAction(selectedOrder, act);
                        setSelectedOrder(null);
                      }
                    }}
                  >
                    {act.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </ConsoleLayout>
  );
}
