'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import ConsoleLayout, { RESTAURANT_NAV } from '@/components/ConsoleLayout';
import { RefreshIcon, ReportsIcon } from '@/components/Icons';
import { useMerchant } from '@/context/MerchantAuth';
import { rmsApi, type SalesReport } from '@/lib/api';
import { inr, toFailure } from '@/lib/format';

export default function ReportsPage() {
  const { merchant, loading } = useMerchant();
  const router = useRouter();
  const merchantId = merchant?.id;

  const [report, setReport] = useState<SalesReport | null>(null);
  const [pending, setPending] = useState(true);
  const [error, setError] = useState('');

  const loadReport = useCallback(async () => {
    if (!merchantId) return;
    setPending(true);
    try {
      const res = await rmsApi.getSalesReport(merchantId);
      setReport(res.data.report || null);
      setError('');
    } catch (err) {
      setError(toFailure(err, 'Could not load sales reports.').message);
    } finally {
      setPending(false);
    }
  }, [merchantId]);

  useEffect(() => {
    if (!loading && !merchant) router.replace('/login');
  }, [loading, merchant, router]);

  useEffect(() => {
    void loadReport();
  }, [loadReport]);

  const summary = report?.summary;
  const byChannel = report?.by_channel;
  const payments = report?.payments_by_method || {};

  return (
    <ConsoleLayout title="Sales & Channel Reports" roleLabel="Restaurant" nav={RESTAURANT_NAV}>
      {error && (
        <div className="nabin-alert nabin-alert--danger" role="alert">
          <span>{error}</span>
          <button className="nabin-alert__action" onClick={() => void loadReport()}>Retry</button>
        </div>
      )}

      <div className="nabin-stack">
        <header className="nabin-card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 900 }}>Financial & Channel Performance</h1>
            <p className="nabin-cell-meta">
              Authoritative breakdown across Dine-In, Takeaway, and Delivery channels, taxes, service charges, and payments.
            </p>
          </div>
          <button onClick={() => void loadReport()} className="nabin-btn nabin-btn--ghost" aria-label="Refresh reports">
            <RefreshIcon />
            <span>Refresh</span>
          </button>
        </header>

        {/* Top KPI Cards */}
        <div className="nabin-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
          <div className="nabin-card">
            <p className="nabin-stat__label">Gross Sales</p>
            <p className="nabin-stat__value nabin-num">{inr(summary?.gross_sales || 0)}</p>
            <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>Before platform commissions</p>
          </div>
          <div className="nabin-card">
            <p className="nabin-stat__label">Total Orders</p>
            <p className="nabin-stat__value nabin-num">{summary?.total_orders ?? '—'}</p>
            <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>Across all 3 channels</p>
          </div>
          <div className="nabin-card">
            <p className="nabin-stat__label">Average Order Value (AOV)</p>
            <p className="nabin-stat__value nabin-num">{inr(summary?.average_order_value || 0)}</p>
            <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>Per completed order</p>
          </div>
          <div className="nabin-card">
            <p className="nabin-stat__label">Net Food Sales</p>
            <p className="nabin-stat__value nabin-num" style={{ color: '#16a34a' }}>{inr(summary?.net_sales || 0)}</p>
            <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>Excluding taxes & service fees</p>
          </div>
        </div>

        {/* Channel Breakdown */}
        <section className="nabin-card">
          <h2 style={{ fontSize: 18, fontWeight: 800, marginBottom: 12 }}>Order Channel Breakdown</h2>
          <div className="nabin-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
            {/* Dine In */}
            <div className="nabin-card" style={{ background: '#f8fafc', border: '1px solid #cbd5e1' }}>
              <div className="nabin-row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
                <strong style={{ fontSize: 16, color: '#1A3BA2' }}>🍽️ Dine-In</strong>
                <span className="nabin-chip">{byChannel?.DINE_IN?.orders_count || 0} Orders</span>
              </div>
              <p className="nabin-stat__value nabin-num" style={{ fontSize: 22 }}>
                {inr(byChannel?.DINE_IN?.total_amount || 0)}
              </p>
              <p style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>
                Floor tables, QR orders, and staff-assisted dining sessions.
              </p>
            </div>

            {/* Takeaway */}
            <div className="nabin-card" style={{ background: '#f8fafc', border: '1px solid #cbd5e1' }}>
              <div className="nabin-row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
                <strong style={{ fontSize: 16, color: '#b45309' }}>🛍️ Takeaway</strong>
                <span className="nabin-chip">{byChannel?.TAKEAWAY?.orders_count || 0} Orders</span>
              </div>
              <p className="nabin-stat__value nabin-num" style={{ fontSize: 22 }}>
                {inr(byChannel?.TAKEAWAY?.total_amount || 0)}
              </p>
              <p style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>
                Customer pickups & counter walk-ins. Zero driver dispatch.
              </p>
            </div>

            {/* Delivery */}
            <div className="nabin-card" style={{ background: '#f8fafc', border: '1px solid #cbd5e1' }}>
              <div className="nabin-row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
                <strong style={{ fontSize: 16, color: '#15803d' }}>🛵 Delivery</strong>
                <span className="nabin-chip">{byChannel?.DELIVERY?.orders_count || 0} Orders</span>
              </div>
              <p className="nabin-stat__value nabin-num" style={{ fontSize: 22 }}>
                {inr(byChannel?.DELIVERY?.total_amount || 0)}
              </p>
              <p style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>
                Dispatched to the NABIN driver network upon ready status.
              </p>
            </div>
          </div>
        </section>

        {/* Taxes, Surcharges & Payment Methods */}
        <div className="nabin-grid nabin-grid--split">
          {/* Taxes & Surcharges */}
          <section className="nabin-card">
            <h2 style={{ fontSize: 17, fontWeight: 800, marginBottom: 12 }}>Taxes & Surcharges Collected</h2>
            <div className="nabin-stack" style={{ gap: 10 }}>
              <div className="nabin-row" style={{ justifyContent: 'space-between', borderBottom: '1px solid var(--border)', paddingBottom: 8 }}>
                <span>GST Tax (Configured Rate):</span>
                <strong className="nabin-num">{inr(summary?.total_tax || 0)}</strong>
              </div>
              <div className="nabin-row" style={{ justifyContent: 'space-between', borderBottom: '1px solid var(--border)', paddingBottom: 8 }}>
                <span>Restaurant Service Charge:</span>
                <strong className="nabin-num">{inr(summary?.total_service_charge || 0)}</strong>
              </div>
              <div className="nabin-row" style={{ justifyContent: 'space-between', borderBottom: '1px solid var(--border)', paddingBottom: 8 }}>
                <span>Packaging & Container Fees:</span>
                <strong className="nabin-num">{inr(summary?.total_packaging_fee || 0)}</strong>
              </div>
              <div className="nabin-row" style={{ justifyContent: 'space-between', paddingTop: 4 }}>
                <strong>Total Add-on Fees:</strong>
                <strong className="nabin-num" style={{ color: '#1A3BA2' }}>
                  {inr((summary?.total_tax || 0) + (summary?.total_service_charge || 0) + (summary?.total_packaging_fee || 0))}
                </strong>
              </div>
            </div>
          </section>

          {/* Payment Methods */}
          <section className="nabin-card">
            <h2 style={{ fontSize: 17, fontWeight: 800, marginBottom: 12 }}>Payment Method Distribution</h2>
            <div className="nabin-stack" style={{ gap: 10 }}>
              {Object.keys(payments).length === 0 ? (
                <p className="nabin-cell-meta">No payment transactions recorded yet.</p>
              ) : (
                Object.entries(payments).map(([method, amt]) => (
                  <div key={method} className="nabin-row" style={{ justifyContent: 'space-between', borderBottom: '1px solid var(--border)', paddingBottom: 8 }}>
                    <span className="nabin-chip" style={{ fontWeight: 700 }}>{method}</span>
                    <strong className="nabin-num">{inr(amt)}</strong>
                  </div>
                ))
              )}
            </div>
          </section>
        </div>

        <p className="nabin-notice">
          📊 <strong>Accounting Notice:</strong> Gross sales represents total food and beverage sales before platform commissions. Net settlement represents funds payable to your merchant account after authorized platform commission and gateway deduction.
        </p>
      </div>
    </ConsoleLayout>
  );
}
