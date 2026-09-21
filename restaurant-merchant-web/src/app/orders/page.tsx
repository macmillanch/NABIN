'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import ConsoleLayout, { RESTAURANT_NAV } from '@/components/ConsoleLayout';
import { ClockIcon, PinIcon, RefreshIcon } from '@/components/Icons';
import { useMerchant } from '@/context/MerchantAuth';
import { merchantApi, type MerchantOrder } from '@/lib/api';
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

export default function OrdersPage() {
  const { merchant, loading } = useMerchant();
  const router = useRouter();
  const [filter, setFilter] = useState('OPEN');
  const [orders, setOrders] = useState<MerchantOrder[]>([]);
  const [pending, setPending] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState('');
  const [rejectingId, setRejectingId] = useState('');
  const [reason, setReason] = useState(REJECTION_REASONS[0]);

  const load = useCallback(
    async (silent = false) => {
      if (!merchant?.id) return;
      if (!silent) setPending(true);
      try {
        const status = filter === 'ALL' || filter === 'OPEN' ? undefined : filter;
        const res = await merchantApi.orders(status);
        const all: MerchantOrder[] = res.data.orders ?? [];
        const rows = all.filter((order) => order.service_type === 'FOOD');
        setOrders(filter === 'OPEN' ? rows.filter((order) => OPEN_STATES.includes(order.order_state)) : rows);
        setError('');
      } catch (err) {
        setError(toFailure(err, 'Could not load the order queue.').message);
      } finally {
        setPending(false);
      }
    },
    [merchant?.id, filter],
  );

  useEffect(() => {
    if (!loading && !merchant) router.replace('/login');
  }, [loading, merchant, router]);

  useEffect(() => {
    load();
    const timer = setInterval(() => load(true), POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  const applyAction = async (order: MerchantOrder, action: MerchantAction) => {
    setBusyId(`${order.id}:${action.status}`);
    setError('');
    try {
      await merchantApi.setOrderStatus(order.id, action.status, action.status === 'REJECTED' ? reason : undefined);
      setRejectingId('');
      await load(true);
    } catch (err) {
      setError(toFailure(err, 'That status change was rejected by the order state machine.').message);
    } finally {
      setBusyId('');
    }
  };

  if (loading || !merchant) {
    return <div className="nabin-skeleton" style={{ minHeight: '100vh', border: 'none' }} />;
  }

  return (
    <ConsoleLayout title="Order queue" roleLabel="Restaurant" nav={RESTAURANT_NAV}>
      <div className="nabin-stack">
        <div className="nabin-page-head" style={{ marginBottom: 0 }}>
          <div>
            <h1>Order queue</h1>
            <p>
              Refreshes every {POLL_MS / 1000} seconds. Status changes follow the server-side order
              state machine; anything illegal is refused rather than faked.
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

        <div className="nabin-row" style={{ flexWrap: 'wrap' }}>
          {FILTERS.map((value) => (
            <button
              key={value}
              onClick={() => setFilter(value)}
              className={`nabin-chip ${filter === value ? 'is-active' : ''}`}
              aria-pressed={filter === value}
            >
              {value === 'OPEN' ? 'Open now' : value === 'ALL' ? 'All orders' : humanise(value)}
            </button>
          ))}
        </div>

        {pending && !orders.length ? (
          <>
            <div className="nabin-skeleton" style={{ height: 180 }} />
            <div className="nabin-skeleton" style={{ height: 180 }} />
          </>
        ) : !orders.length ? (
          <div className="nabin-card nabin-empty">
            <p className="nabin-empty__title">Nothing in this queue</p>
            <p>No food orders match “{filter === 'ALL' ? 'All orders' : humanise(filter)}” right now.</p>
          </div>
        ) : (
          orders.map((order) => {
            const actions = MERCHANT_ACTIONS[order.order_state] ?? [];
            const lines = linesOf(order);
            return (
              <article key={order.id} className="nabin-card">
                <div className="nabin-card__header">
                  <div className="nabin-cell-stack">
                    <span className="nabin-cell-title" style={{ fontSize: 17 }}>
                      {order.order_number}
                    </span>
                    <span className="nabin-cell-meta">
                      <ClockIcon size={13} /> {dateTime(order.created_at)}
                    </span>
                  </div>
                  <div className="nabin-row">
                    <span className={`nabin-badge nabin-badge--${STATE_TONE[order.order_state] ?? 'neutral'}`}>
                      {humanise(order.order_state)}
                    </span>
                    <span className="nabin-order__amount">{inr(order.total_amount)}</span>
                  </div>
                </div>

                {lines.length > 0 ? (
                  <div className="nabin-table-wrap" style={{ marginBottom: 'var(--space-md)' }}>
                    <table className="nabin-table">
                      <thead>
                        <tr>
                          <th>Item</th>
                          <th>Qty</th>
                          <th className="nabin--end">Price</th>
                          <th className="nabin--end nabin-hide-sm">Line total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {lines.map((line, index) => (
                          <tr key={line.product_name_snapshot ?? index}>
                            <td className="nabin-cell-title">{line.product_name_snapshot ?? 'Menu item'}</td>
                            <td className="nabin-num">
                              {line.quantity} {line.unit_snapshot ?? 'piece'}
                            </td>
                            <td className="nabin--end nabin-num">{inr(line.unit_price_snapshot)}</td>
                            <td className="nabin--end nabin-num nabin-hide-sm">{inr(line.line_total)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="nabin-cell-meta" style={{ marginBottom: 'var(--space-md)' }}>
                    This order has no line items on record.
                  </p>
                )}

                {order.metadata?.deliveryAddress && (
                  <p className="nabin-cell-meta" style={{ marginBottom: 'var(--space-xs)' }}>
                    <PinIcon size={13} /> {order.metadata.deliveryAddress}
                  </p>
                )}
                {order.metadata?.deliveryInstructions && (
                  <p className="nabin-cell-meta">{order.metadata.deliveryInstructions}</p>
                )}

                {actions.length > 0 && (
                  <div className="nabin-row" style={{ flexWrap: 'wrap', marginTop: 'var(--space-md)' }}>
                    {rejectingId === order.id ? (
                      <>
                        <label className="nabin-visually-hidden" htmlFor={`reason-${order.id}`}>
                          Rejection reason
                        </label>
                        <select
                          id={`reason-${order.id}`}
                          className="nabin-input"
                          style={{ maxWidth: 240 }}
                          value={reason}
                          onChange={(e) => setReason(e.target.value)}
                        >
                          {REJECTION_REASONS.map((value) => (
                            <option key={value} value={value}>
                              {prettyReason(value)}
                            </option>
                          ))}
                        </select>
                        <button
                          onClick={() =>
                            applyAction(order, { status: 'REJECTED', label: 'Reject', tone: 'danger' })
                          }
                          className="nabin-btn nabin-btn--danger"
                          disabled={busyId === `${order.id}:REJECTED`}
                        >
                          Confirm rejection
                        </button>
                        <button
                          onClick={() => setRejectingId('')}
                          className="nabin-btn nabin-btn--ghost"
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      actions.map((action) => (
                        <button
                          key={action.status}
                          onClick={() =>
                            action.status === 'REJECTED'
                              ? setRejectingId(order.id)
                              : applyAction(order, action)
                          }
                          className={`nabin-btn ${action.tone === 'danger' ? 'nabin-btn--danger' : 'nabin-btn--primary'}`}
                          disabled={Boolean(busyId)}
                        >
                          {busyId === `${order.id}:${action.status}` ? 'Working…' : action.label}
                        </button>
                      ))
                    )}
                  </div>
                )}

                {!actions.length && order.order_state === 'READY_FOR_PICKUP' ? (
                  <p className="nabin-notice" style={{ marginTop: 'var(--space-md)' }}>
                    Handed to the delivery partner — the driver confirms pickup, not the kitchen.
                  </p>
                ) : null}
              </article>
            );
          })
        )}
      </div>
    </ConsoleLayout>
  );
}
