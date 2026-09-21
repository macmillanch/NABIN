'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import ConsoleLayout, { GROCERY_NAV } from '@/components/ConsoleLayout';
import { ClockIcon, PinIcon, RefreshIcon } from '@/components/Icons';
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

const FILTERS = ['OPEN', 'RECEIVED', 'ACCEPTED', 'PACKING', 'READY_FOR_PICKUP', 'ALL'];
const OPEN_STATES = ['RECEIVED', 'ACCEPTED', 'PREPARING', 'PACKING', 'READY_FOR_PICKUP'];
const POLL_MS = 15000;

export default function OrdersPage() {
  const { merchant, loading } = useMerchant();
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

  const load = useCallback(
    async (silent = false) => {
      if (!merchant?.id) return;
      if (!silent) setPending(true);
      try {
        const status = filter === 'ALL' || filter === 'OPEN' ? undefined : filter;
        const res = await merchantApi.orders(status);
        const all: MerchantOrder[] = res.data.orders ?? [];
        const rows = all.filter((order) => order.service_type === 'GROCERY');
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
    try {
      await merchantApi.setPackedWeight(order.id, lineId, Number(value));
      setNotice(`${line.product_name_snapshot}: packed ${value} ${line.unit_snapshot ?? 'unit'} recorded.`);
      await load(true);
    } catch (err) {
      setError(toFailure(err, 'The packed weight was refused — it cannot exceed the ordered quantity.').message);
    } finally {
      setBusyId('');
    }
  };

  if (loading || !merchant) {
    return <div className="nabin-skeleton" style={{ minHeight: '100vh', border: 'none' }} />;
  }

  return (
    <ConsoleLayout title="Order queue" roleLabel="Grocery" nav={GROCERY_NAV}>
      <div className="nabin-stack">
        <div className="nabin-page-head" style={{ marginBottom: 0 }}>
          <div>
            <h1>Order queue</h1>
            <p>
              Refreshes every {POLL_MS / 1000} seconds. Bulk and loose goods must be weighed before
              handover so the customer is billed for what actually left the shelf.
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
          <div className="nabin-alert nabin-alert--success" role="status">
            <span>{notice}</span>
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
            <div className="nabin-skeleton" style={{ height: 200 }} />
            <div className="nabin-skeleton" style={{ height: 200 }} />
          </>
        ) : !orders.length ? (
          <div className="nabin-card nabin-empty">
            <p className="nabin-empty__title">Nothing in this queue</p>
            <p>No grocery orders match “{filter === 'ALL' ? 'All orders' : humanise(filter)}” right now.</p>
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

                {lines.length ? (
                  <div className="nabin-table-wrap" style={{ marginBottom: 'var(--space-md)' }}>
                    <table className="nabin-table">
                      <thead>
                        <tr>
                          <th>Item</th>
                          <th>Ordered</th>
                          <th className="nabin--end">Rate</th>
                          <th className="nabin--end nabin-hide-sm">Line total</th>
                          <th>Packed weight</th>
                        </tr>
                      </thead>
                      <tbody>
                        {lines.map((line, index) => {
                          const lineId = line.id ?? line.grocery_inventory_id ?? `line_${index}`;
                          const already = line.packed_confirmed_quantity;
                          return (
                            <tr key={lineId}>
                              <td>
                                <div className="nabin-cell-stack">
                                  <span className="nabin-cell-title">
                                    {line.product_name_snapshot ?? 'Item'}
                                  </span>
                                  {line.is_partially_fulfilled && (
                                    <span className="nabin-badge nabin-badge--warning">
                                      Partially fulfilled
                                    </span>
                                  )}
                                </div>
                              </td>
                              <td className="nabin-num">
                                {line.quantity} {line.unit_snapshot ?? 'unit'}
                              </td>
                              <td className="nabin--end nabin-num">{inr(line.unit_price_snapshot)}</td>
                              <td className="nabin--end nabin-num nabin-hide-sm">
                                {inr(line.line_total)}
                              </td>
                              <td>
                                {line.id || line.grocery_inventory_id ? (
                                  <div className="nabin-row" style={{ justifyContent: 'flex-end' }}>
                                    <input
                                      className="nabin-input"
                                      style={{ width: 96, textAlign: 'right' }}
                                      type="number"
                                      inputMode="decimal"
                                      step="0.001"
                                      min="0"
                                      max={String(line.quantity ?? '')}
                                      aria-label={`Packed weight for ${line.product_name_snapshot ?? 'item'}`}
                                      value={weights[lineId] ?? (already != null ? String(already) : '')}
                                      onChange={(e) =>
                                        setWeights((prev) => ({ ...prev, [lineId]: e.target.value }))
                                      }
                                    />
                                    <button
                                      onClick={() => submitWeight(order, line)}
                                      className="nabin-btn nabin-btn--ghost"
                                      style={{ minHeight: 40, padding: '0 var(--space-sm)' }}
                                      disabled={busyId === `weight:${lineId}` || !weights[lineId]}
                                    >
                                      {busyId === `weight:${lineId}` ? 'Saving…' : 'Save'}
                                    </button>
                                  </div>
                                ) : (
                                  <span className="nabin-cell-meta">No line record</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="nabin-cell-meta" style={{ marginBottom: 'var(--space-md)' }}>
                    This order has no line items on record, so nothing can be weighed against it.
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
                        <button onClick={() => setRejectingId('')} className="nabin-btn nabin-btn--ghost">
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

                {!actions.length && order.order_state === 'READY_FOR_PICKUP' && (
                  <p className="nabin-notice" style={{ marginTop: 'var(--space-md)' }}>
                    Handed to the delivery partner — the driver confirms pickup, not the store.
                  </p>
                )}
              </article>
            );
          })
        )}
      </div>
    </ConsoleLayout>
  );
}
