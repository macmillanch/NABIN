'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import ConsoleLayout, { RESTAURANT_NAV } from '@/components/ConsoleLayout';
import { RefreshIcon, CheckIcon, ClockIcon } from '@/components/Icons';
import { useMerchant } from '@/context/MerchantAuth';
import { merchantApi, rmsApi, type MerchantOrder } from '@/lib/api';
import { dateTime, inr, toFailure } from '@/lib/format';
import { STATE_TONE, humanise } from '@/lib/orderFlow';

export default function TakeawayPage() {
  const { merchant, loading } = useMerchant();
  const router = useRouter();
  const merchantId = merchant?.id;

  const [orders, setOrders] = useState<MerchantOrder[]>([]);
  const [pending, setPending] = useState(true);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Handover modal state
  const [selectedOrder, setSelectedOrder] = useState<MerchantOrder | null>(null);
  const [handoverStaffName, setHandoverStaffName] = useState('');
  const [handoverInProgress, setHandoverInProgress] = useState(false);

  const loadTakeawayOrders = useCallback(async () => {
    if (!merchantId) return;
    setPending(true);
    try {
      const res = await merchantApi.orders();
      const allOrders: MerchantOrder[] = res.data.orders || [];
      // Filter for takeaway channel or orders without delivery address marked for pickup
      const takeawayOnly = allOrders.filter(
        (o) => o.order_channel === 'TAKEAWAY' || (!o.metadata?.deliveryAddress && o.service_type === 'FOOD')
      );
      setOrders(takeawayOnly);
      setError('');
    } catch (err) {
      setError(toFailure(err, 'Failed to fetch takeaway orders.').message);
    } finally {
      setPending(false);
    }
  }, [merchantId]);

  useEffect(() => {
    if (!loading && !merchant) router.replace('/login');
  }, [loading, merchant, router]);

  useEffect(() => {
    void loadTakeawayOrders();
  }, [loadTakeawayOrders]);

  const handleAdvanceStatus = async (orderId: string, nextStatus: string) => {
    if (!merchantId) return;
    try {
      await merchantApi.setOrderStatus(orderId, nextStatus);
      setSuccessMsg(`Order updated to ${nextStatus}`);
      void loadTakeawayOrders();
    } catch (err) {
      setError(toFailure(err, 'Could not advance order state.').message);
    }
  };

  const handleRecordHandover = async () => {
    if (!merchantId || !selectedOrder) return;
    setHandoverInProgress(true);
    try {
      await rmsApi.recordTakeawayHandover(
        merchantId,
        selectedOrder.id,
        handoverStaffName.trim() || merchant?.name || 'Staff'
      );
      setSuccessMsg(`Order ${selectedOrder.order_number} verified and handed over!`);
      setSelectedOrder(null);
      setHandoverStaffName('');
      void loadTakeawayOrders();
    } catch (err) {
      setError(toFailure(err, 'Handover verification failed.').message);
    } finally {
      setHandoverInProgress(false);
    }
  };

  return (
    <ConsoleLayout title="Takeaway Orders" roleLabel="Restaurant" nav={RESTAURANT_NAV}>
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
            <h1 style={{ fontSize: 22, fontWeight: 900 }}>Takeaway Pickup Queue</h1>
            <p className="nabin-cell-meta">
              Customer pickups and walk-in takeaway orders. Takeaway orders never dispatch drivers.
            </p>
          </div>
          <button onClick={() => void loadTakeawayOrders()} className="nabin-btn nabin-btn--ghost" aria-label="Refresh">
            <RefreshIcon />
            <span>Refresh</span>
          </button>
        </header>

        {/* Notice */}
        <p className="nabin-notice" style={{ background: '#fef3c7', borderColor: '#fde68a', color: '#92400e' }}>
          💡 <strong>Takeaway Handover Rule:</strong> When customer arrives to collect, verify order number and click <strong>Handover & Complete</strong> to record staff signature and completion timestamp.
        </p>

        {/* Orders Table */}
        <div className="nabin-card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: 13 }}>
              <thead>
                <tr style={{ background: '#f8fafc', borderBottom: '1px solid var(--border)' }}>
                  <th style={{ padding: '12px 16px', fontWeight: 700 }}>Order #</th>
                  <th style={{ padding: '12px 16px', fontWeight: 700 }}>Customer</th>
                  <th style={{ padding: '12px 16px', fontWeight: 700 }}>Items</th>
                  <th style={{ padding: '12px 16px', fontWeight: 700 }}>Amount</th>
                  <th style={{ padding: '12px 16px', fontWeight: 700 }}>Pickup Time</th>
                  <th style={{ padding: '12px 16px', fontWeight: 700 }}>Status</th>
                  <th style={{ padding: '12px 16px', fontWeight: 700, textAlign: 'right' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {pending && !orders.length ? (
                  <tr>
                    <td colSpan={7} style={{ padding: 24, textAlign: 'center', color: 'var(--muted)' }}>
                      Loading takeaway orders...
                    </td>
                  </tr>
                ) : orders.length === 0 ? (
                  <tr>
                    <td colSpan={7} style={{ padding: 24, textAlign: 'center', color: 'var(--muted)' }}>
                      No active takeaway orders found.
                    </td>
                  </tr>
                ) : (
                  orders.map((o) => {
                    const isReady = o.order_state === 'READY_FOR_PICKUP';
                    const isCompleted = o.order_state === 'COLLECTED' || o.order_state === 'DELIVERED';
                    return (
                      <tr key={o.id} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={{ padding: '12px 16px', fontWeight: 800, color: '#1A3BA2' }}>
                          {o.order_number}
                          <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 400 }}>
                            {dateTime(o.created_at)}
                          </div>
                        </td>
                        <td style={{ padding: '12px 16px' }}>
                          <strong>{o.metadata?.customerName || 'Customer'}</strong>
                        </td>
                        <td style={{ padding: '12px 16px' }}>
                          {o.lines && o.lines.length > 0 ? (
                            <span>{o.lines.map((l) => `${l.quantity}x ${l.product_name_snapshot}`).join(', ')}</span>
                          ) : (
                            <span style={{ color: 'var(--muted)' }}>Details in kitchen ticket</span>
                          )}
                        </td>
                        <td style={{ padding: '12px 16px', fontWeight: 700 }}>
                          {inr(o.total_amount)}
                        </td>
                        <td style={{ padding: '12px 16px' }}>
                          {o.metadata?.pickupTime ? (
                            <span className="nabin-chip" style={{ fontSize: 11 }}>
                              <ClockIcon size={12} /> {o.metadata.pickupTime}
                            </span>
                          ) : (
                            <span style={{ color: 'var(--muted)' }}>ASAP (15-20m)</span>
                          )}
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
                              Mark Ready
                            </button>
                          )}
                          {isReady && (
                            <button
                              onClick={() => {
                                setSelectedOrder(o);
                                setHandoverStaffName('');
                              }}
                              className="nabin-btn nabin-btn--primary"
                              style={{ padding: '4px 10px', fontSize: 12, minHeight: 30, background: '#1A3BA2' }}
                            >
                              <CheckIcon size={14} />
                              <span>Handover</span>
                            </button>
                          )}
                          {isCompleted && (
                            <span style={{ color: '#16a34a', fontSize: 12, fontWeight: 700 }}>✓ Completed</span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Handover Verification Modal */}
      {selectedOrder && (
        <div className="nabin-scrim" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="nabin-card" style={{ maxWidth: 420, width: '90%', margin: 16 }}>
            <h3 style={{ fontSize: 18, fontWeight: 800, marginBottom: 8 }}>
              Verify Takeaway Handover
            </h3>
            <p className="nabin-cell-meta" style={{ marginBottom: 16 }}>
              Order: <strong>{selectedOrder.order_number}</strong> &middot; Total: {inr(selectedOrder.total_amount)}
            </p>
            <div className="nabin-stack" style={{ gap: 12 }}>
              <div>
                <label style={{ fontSize: 13, display: 'block', marginBottom: 4 }}>Staff Name / ID Completing Handover</label>
                <input
                  type="text"
                  placeholder="e.g. Ramesh K. (Counter 1)"
                  value={handoverStaffName}
                  onChange={(e) => setHandoverStaffName(e.target.value)}
                  style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)' }}
                />
              </div>
              <div className="nabin-row" style={{ justifyContent: 'flex-end', marginTop: 8 }}>
                <button
                  type="button"
                  disabled={handoverInProgress}
                  onClick={() => setSelectedOrder(null)}
                  className="nabin-btn nabin-btn--ghost"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={handoverInProgress}
                  onClick={handleRecordHandover}
                  className="nabin-btn nabin-btn--primary"
                >
                  {handoverInProgress ? 'Verifying...' : 'Confirm Handover & Complete'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </ConsoleLayout>
  );
}
