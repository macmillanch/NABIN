'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import ConsoleLayout, { RESTAURANT_NAV } from '@/components/ConsoleLayout';
import { RefreshIcon, ClockIcon } from '@/components/Icons';
import { useMerchant } from '@/context/MerchantAuth';
import { rmsApi, type KdsTicket } from '@/lib/api';
import { toFailure } from '@/lib/format';

const CHANNEL_BADGES: Record<string, { label: string; color: string; bg: string }> = {
  DINE_IN: { label: '🍽️ Dine-In', color: '#1A3BA2', bg: '#EBF1FF' },
  TAKEAWAY: { label: '🛍️ Takeaway', color: '#b45309', bg: '#fef3c7' },
  DELIVERY: { label: '🛵 Delivery', color: '#15803d', bg: '#dcfce7' },
};

const KDS_COLUMNS = [
  { key: 'NEW', title: 'New Tickets', tone: 'neutral' },
  { key: 'PREPARING', title: 'Cooking / Preparing', tone: 'warning' },
  { key: 'READY', title: 'Ready to Serve / Pickup', tone: 'success' },
];

export default function KdsPage() {
  const { merchant, loading } = useMerchant();
  const router = useRouter();
  const merchantId = merchant?.id;

  const [tickets, setTickets] = useState<KdsTicket[]>([]);
  const [pending, setPending] = useState(true);
  const [error, setError] = useState('');
  const [lastRefreshed, setLastRefreshed] = useState<Date>(new Date());
  const [advancingId, setAdvancingId] = useState<string>('');

  const loadTickets = useCallback(async (silent = false) => {
    if (!merchantId) return;
    if (!silent) setPending(true);
    try {
      const res = await rmsApi.getKdsTickets(merchantId);
      setTickets(res.data.tickets || []);
      setLastRefreshed(new Date());
      setError('');
    } catch (err) {
      setError(toFailure(err, 'Failed to fetch KDS tickets.').message);
    } finally {
      setPending(false);
    }
  }, [merchantId]);

  useEffect(() => {
    if (!loading && !merchant) router.replace('/login');
  }, [loading, merchant, router]);

  useEffect(() => {
    void loadTickets();
    const timer = setInterval(() => {
      void loadTickets(true);
    }, 10000);
    return () => clearInterval(timer);
  }, [loadTickets]);

  const advanceTicket = async (ticketId: string, nextStatus: string) => {
    if (!merchantId) return;
    setAdvancingId(ticketId);
    try {
      await rmsApi.updateKdsTicket(merchantId, ticketId, nextStatus);
      void loadTickets(true);
    } catch (err) {
      setError(toFailure(err, 'Could not advance ticket status.').message);
    } finally {
      setAdvancingId('');
    }
  };

  const getElapsedTime = (createdAt: string) => {
    const elapsedMinutes = Math.floor((Date.now() - new Date(createdAt).getTime()) / 60000);
    return elapsedMinutes > 0 ? `${elapsedMinutes}m ago` : 'Just now';
  };

  return (
    <ConsoleLayout title="Kitchen Display System (KDS)" roleLabel="Restaurant" nav={RESTAURANT_NAV}>
      {error && (
        <div className="nabin-alert nabin-alert--danger" role="alert">
          <span>{error}</span>
          <button className="nabin-alert__action" onClick={() => setError('')}>Dismiss</button>
        </div>
      )}

      <div className="nabin-stack">
        <header className="nabin-card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 900 }}>Live Kitchen Queue</h1>
            <p className="nabin-cell-meta">
              Real-time kitchen order tickets across Dine-In, Takeaway, and Delivery. Auto-refreshes every 10s.
            </p>
          </div>
          <div className="nabin-row" style={{ gap: 12 }}>
            <span className="nabin-chip" style={{ fontSize: 12 }}>
              <ClockIcon size={14} /> Updated: {lastRefreshed.toLocaleTimeString()}
            </span>
            <button onClick={() => void loadTickets()} className="nabin-btn nabin-btn--ghost" aria-label="Refresh KDS">
              <RefreshIcon />
              <span>Refresh</span>
            </button>
          </div>
        </header>

        {/* 3-Column Kanban Board for KDS */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16, alignItems: 'start' }}>
          {KDS_COLUMNS.map((col) => {
            const colTickets = tickets.filter((t) => t.status === col.key);
            return (
              <div key={col.key} className="nabin-card" style={{ background: '#f8fafc', padding: 14 }}>
                <div className="nabin-row" style={{ justifyContent: 'space-between', marginBottom: 12, borderBottom: '2px solid #e2e8f0', paddingBottom: 8 }}>
                  <h2 style={{ fontSize: 16, fontWeight: 800 }}>{col.title}</h2>
                  <span className="nabin-badge nabin-badge--primary" style={{ fontSize: 12 }}>{colTickets.length}</span>
                </div>

                {colTickets.length === 0 ? (
                  <p className="nabin-cell-meta" style={{ textAlign: 'center', padding: '24px 0' }}>
                    No tickets in this stage.
                  </p>
                ) : (
                  <div className="nabin-stack" style={{ gap: 12 }}>
                    {colTickets.map((t) => {
                      const ch = CHANNEL_BADGES[t.order_channel] || { label: t.order_channel, color: '#334155', bg: '#f1f5f9' };
                      const isAdvancing = advancingId === t.id;
                      return (
                        <div
                          key={t.id}
                          className="nabin-card"
                          style={{
                            background: '#ffffff',
                            border: '1px solid #cbd5e1',
                            borderRadius: 12,
                            padding: 14,
                            boxShadow: '0 2px 4px rgba(0,0,0,0.04)',
                          }}
                        >
                          {/* Ticket Header */}
                          <div className="nabin-row" style={{ justifyContent: 'space-between', marginBottom: 8, alignItems: 'flex-start' }}>
                            <div>
                              <strong style={{ fontSize: 16, color: '#1A3BA2' }}>{t.ticket_number || t.order_number}</strong>
                              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                                {getElapsedTime(t.created_at)} &middot; Est. {t.prep_time_minutes || 20}m
                              </div>
                            </div>
                            <span
                              style={{
                                fontSize: 11,
                                fontWeight: 700,
                                padding: '3px 8px',
                                borderRadius: 6,
                                color: ch.color,
                                background: ch.bg,
                              }}
                            >
                              {ch.label}
                            </span>
                          </div>

                          {/* Table Number if Dine-In */}
                          {t.order_channel === 'DINE_IN' && t.table_number && (
                            <div
                              style={{
                                background: '#EBF1FF',
                                color: '#1A3BA2',
                                fontWeight: 800,
                                fontSize: 13,
                                padding: '4px 8px',
                                borderRadius: 6,
                                marginBottom: 10,
                                display: 'inline-block',
                              }}
                            >
                              Table: {t.table_number}
                            </div>
                          )}

                          {/* Order Items */}
                          <div style={{ borderTop: '1px solid #f1f5f9', paddingTop: 8, marginBottom: 12 }}>
                            {t.items && t.items.map((item, idx) => (
                              <div key={idx} style={{ marginBottom: 6 }}>
                                <div className="nabin-row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                  <span style={{ fontSize: 14, fontWeight: 600 }}>
                                    <strong style={{ color: '#1A3BA2', marginRight: 4 }}>{item.quantity}x</strong>
                                    {item.product_name}
                                  </span>
                                </div>
                                {item.modifiers && item.modifiers.length > 0 && (
                                  <div style={{ fontSize: 11, color: '#64748b', marginLeft: 16 }}>
                                    + {item.modifiers.join(', ')}
                                  </div>
                                )}
                                {item.notes && (
                                  <div style={{ fontSize: 11, color: '#b45309', marginLeft: 16, fontStyle: 'italic' }}>
                                    Note: {item.notes}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>

                          {/* Action Button */}
                          <div className="nabin-row" style={{ justifyContent: 'flex-end', gap: 8 }}>
                            {col.key === 'NEW' && (
                              <button
                                disabled={isAdvancing}
                                onClick={() => advanceTicket(t.id, 'PREPARING')}
                                className="nabin-btn nabin-btn--primary"
                                style={{ width: '100%', justifyContent: 'center', minHeight: 36 }}
                              >
                                {isAdvancing ? 'Starting...' : 'Start Cooking'}
                              </button>
                            )}
                            {col.key === 'PREPARING' && (
                              <button
                                disabled={isAdvancing}
                                onClick={() => advanceTicket(t.id, 'READY')}
                                className="nabin-btn nabin-btn--primary"
                                style={{ width: '100%', justifyContent: 'center', minHeight: 36, background: '#16a34a' }}
                              >
                                {isAdvancing ? 'Updating...' : 'Mark Food Ready'}
                              </button>
                            )}
                            {col.key === 'READY' && (
                              <button
                                disabled={isAdvancing}
                                onClick={() => advanceTicket(t.id, 'SERVED')}
                                className="nabin-btn nabin-btn--ghost"
                                style={{ width: '100%', justifyContent: 'center', minHeight: 36 }}
                              >
                                {isAdvancing ? 'Updating...' : 'Mark Served / Handed Over'}
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </ConsoleLayout>
  );
}
