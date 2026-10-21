'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import ConsoleLayout, { RESTAURANT_NAV } from '@/components/ConsoleLayout';
import { RefreshIcon, DeliveryIcon, PinIcon } from '@/components/Icons';
import { useMerchant } from '@/context/MerchantAuth';
import { merchantApi, type MerchantOrder } from '@/lib/api';
import { dateTime, inr, toFailure } from '@/lib/format';
import { STATE_TONE, humanise } from '@/lib/orderFlow';

export default function DeliveryPage() {
  const { merchant, loading } = useMerchant();
  const router = useRouter();
  const merchantId = merchant?.id;

  const [orders, setOrders] = useState<MerchantOrder[]>([]);
  const [pending, setPending] = useState(true);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const loadDeliveryOrders = useCallback(async () => {
    if (!merchantId) return;
    setPending(true);
    try {
      const res = await merchantApi.orders();
      const allOrders: MerchantOrder[] = res.data.orders || [];
      const deliveryOnly = allOrders.filter(
        (o) => o.order_channel === 'DELIVERY' || (o.metadata?.deliveryAddress && o.service_type === 'FOOD')
      );
      setOrders(deliveryOnly);
      setError('');
    } catch (err) {
      setError(toFailure(err, 'Failed to fetch delivery orders.').message);
    } finally {
      setPending(false);
    }
  }, [merchantId]);

  useEffect(() => {
    if (!loading && !merchant) router.replace('/login');
  }, [loading, merchant, router]);

  useEffect(() => {
    void loadDeliveryOrders();
  }, [loadDeliveryOrders]);

  const handleAdvanceStatus = async (orderId: string, nextStatus: string) => {
    if (!merchantId) return;
    try {
      await merchantApi.setOrderStatus(orderId, nextStatus);
      setSuccessMsg(`Delivery order updated to ${nextStatus}. If Ready, driver dispatch broadcasted.`);
      void loadDeliveryOrders();
    } catch (err) {
      setError(toFailure(err, 'Status update failed.').message);
    }
  };

  return (
    <ConsoleLayout title="Food Delivery" roleLabel="Restaurant" nav={RESTAURANT_NAV}>
      {error && (
        <div className="nabin-alert nabin-alert--danger" role="alert">
          <span>{error}</span>
          <button className="nabin-alert__action" onClick={() => setError('')}>Dismiss</button>
        </div>
      )}
      {successMsg && (
        <div className="nabin-alert nabin-alert--success" role="status">
          <span>{successMsg}</span>
          <button className="nabin-alert__action" onClick={() => setSuccessMsg('')}>Dismiss</button>
        </div>
      )}

      <div className="nabin-stack">
        <header className="nabin-card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 900 }}>Food Delivery Dispatch & Orders</h1>
            <p className="nabin-cell-meta">
              Delivery orders integrated with the NABIN Driver fleet. Marking &quot;Ready for Pickup&quot; broadcasts to nearby drivers.
            </p>
          </div>
          <button onClick={() => void loadDeliveryOrders()} className="nabin-btn nabin-btn--ghost" aria-label="Refresh">
            <RefreshIcon />
            <span>Refresh</span>
          </button>
        </header>

        <div className="nabin-grid">
          <div className="nabin-card">
            <p className="nabin-stat__label">Active Deliveries</p>
            <p className="nabin-stat__value nabin-num">
              {orders.filter((o) => !['DELIVERED', 'CANCELLED', 'REJECTED'].includes(o.order_state)).length}
            </p>
          </div>
          <div className="nabin-card">
            <p className="nabin-stat__label">Awaiting Driver Pickup</p>
            <p className="nabin-stat__value nabin-num">
              {orders.filter((o) => o.order_state === 'READY_FOR_PICKUP').length}
            </p>
          </div>
          <div className="nabin-card">
            <p className="nabin-stat__label">Completed Deliveries</p>
            <p className="nabin-stat__value nabin-num">
              {orders.filter((o) => o.order_state === 'DELIVERED').length}
            </p>
          </div>
        </div>

        {/* Orders List */}
        <div className="nabin-card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: 13 }}>
              <thead>
                <tr style={{ background: '#f8fafc', borderBottom: '1px solid var(--border)' }}>
                  <th style={{ padding: '12px 16px', fontWeight: 700 }}>Order #</th>
                  <th style={{ padding: '12px 16px', fontWeight: 700 }}>Customer & Destination</th>
                  <th style={{ padding: '12px 16px', fontWeight: 700 }}>Items</th>
                  <th style={{ padding: '12px 16px', fontWeight: 700 }}>Amount</th>
                  <th style={{ padding: '12px 16px', fontWeight: 700 }}>Status</th>
                  <th style={{ padding: '12px 16px', fontWeight: 700, textAlign: 'right' }}>Kitchen Action</th>
                </tr>
              </thead>
              <tbody>
                {pending && !orders.length ? (
                  <tr>
                    <td colSpan={6} style={{ padding: 24, textAlign: 'center', color: 'var(--muted)' }}>
                      Loading delivery orders...
                    </td>
                  </tr>
                ) : orders.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ padding: 24, textAlign: 'center', color: 'var(--muted)' }}>
                      No delivery orders found.
                    </td>
                  </tr>
                ) : (
                  orders.map((o) => (
                    <tr key={o.id} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '12px 16px', fontWeight: 800, color: '#1A3BA2' }}>
                        {o.order_number}
                        <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 400 }}>
                          {dateTime(o.created_at)}
                        </div>
                      </td>
                      <td style={{ padding: '12px 16px', maxWidth: 280 }}>
                        <strong>{o.metadata?.customerName || 'Customer'}</strong>
                        <div style={{ fontSize: 11, color: '#475569', display: 'flex', alignItems: 'center', gap: 4, marginTop: 2 }}>
                          <PinIcon size={12} />
                          <span>{o.metadata?.deliveryAddress || 'Address on file'}</span>
                        </div>
                        {o.metadata?.deliveryInstructions && (
                          <div style={{ fontSize: 11, color: '#b45309', fontStyle: 'italic', marginTop: 2 }}>
                            Note: {o.metadata.deliveryInstructions}
                          </div>
                        )}
                      </td>
                      <td style={{ padding: '12px 16px' }}>
                        {o.lines && o.lines.length > 0 ? (
                          <span>{o.lines.map((l) => `${l.quantity}x ${l.product_name_snapshot}`).join(', ')}</span>
                        ) : (
                          <span style={{ color: 'var(--muted)' }}>Standard items</span>
                        )}
                      </td>
                      <td style={{ padding: '12px 16px', fontWeight: 700 }}>
                        {inr(o.total_amount)}
                      </td>
                      <td style={{ padding: '12px 16px' }}>
                        <span className={`nabin-badge nabin-badge--${STATE_TONE[o.order_state] || 'neutral'}`}>
                          {humanise(o.order_state)}
                        </span>
                      </td>
                      <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                        {o.order_state === 'RECEIVED' && (
                          <button
                            onClick={() => handleAdvanceStatus(o.id, 'PREPARING')}
                            className="nabin-btn nabin-btn--primary"
                            style={{ padding: '4px 10px', fontSize: 12, minHeight: 30 }}
                          >
                            Accept & Prep
                          </button>
                        )}
                        {o.order_state === 'PREPARING' && (
                          <button
                            onClick={() => handleAdvanceStatus(o.id, 'READY_FOR_PICKUP')}
                            className="nabin-btn nabin-btn--primary"
                            style={{ padding: '4px 10px', fontSize: 12, minHeight: 30, background: '#16a34a' }}
                          >
                            <DeliveryIcon size={14} />
                            <span>Mark Ready & Dispatch</span>
                          </button>
                        )}
                        {o.order_state === 'READY_FOR_PICKUP' && (
                          <span className="nabin-chip" style={{ fontSize: 11, background: '#dcfce7', color: '#166534' }}>
                            Dispatched to Drivers
                          </span>
                        )}
                        {o.order_state === 'OUT_FOR_DELIVERY' && (
                          <span className="nabin-chip" style={{ fontSize: 11, background: '#e0f2fe', color: '#075985' }}>
                            On the way
                          </span>
                        )}
                        {o.order_state === 'DELIVERED' && (
                          <span style={{ color: '#16a34a', fontSize: 12, fontWeight: 700 }}>✓ Delivered</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </ConsoleLayout>
  );
}
