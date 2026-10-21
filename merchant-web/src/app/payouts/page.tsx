'use client';

import React, { useState } from 'react';
import ConsoleLayout from '@/components/ConsoleLayout';
import { useMerchant } from '@/context/MerchantAuth';
import { RefreshIcon, CheckCircleIcon, ClockIcon, ArrowRightIcon } from '@/components/Icons';

interface SettlementBatch {
  id: string;
  period: string;
  orderCount: number;
  grossAmount: number;
  platformFee: number;
  taxDeducted: number;
  netPayout: number;
  settledAt: string;
  status: 'SETTLED' | 'PROCESSING' | 'PENDING';
  reference: string;
}

const DEMO_SETTLEMENTS: SettlementBatch[] = [
  {
    id: 'DEMO-STL-401',
    period: 'Oct 01 - Oct 07, 2026',
    orderCount: 142,
    grossAmount: 84600,
    platformFee: 12690, // 15%
    taxDeducted: 846, // 1% TDS
    netPayout: 71064,
    settledAt: '2026-10-08T10:30:00Z',
    status: 'SETTLED',
    reference: 'DEMO-TXN-991204',
  },
  {
    id: 'DEMO-STL-398',
    period: 'Sep 24 - Sep 30, 2026',
    orderCount: 128,
    grossAmount: 76200,
    platformFee: 11430,
    taxDeducted: 762,
    netPayout: 64008,
    settledAt: '2026-10-01T11:15:00Z',
    status: 'SETTLED',
    reference: 'DEMO-TXN-882109',
  },
  {
    id: 'DEMO-STL-392',
    period: 'Sep 17 - Sep 23, 2026',
    orderCount: 119,
    grossAmount: 69800,
    platformFee: 10470,
    taxDeducted: 698,
    netPayout: 58632,
    settledAt: '2026-09-24T09:45:00Z',
    status: 'SETTLED',
    reference: 'DEMO-TXN-773412',
  },
];

export default function PayoutsPage() {
  const { merchant, merchantType, isHybrid } = useMerchant();
  const [settlements] = useState<SettlementBatch[]>(DEMO_SETTLEMENTS);
  const [selectedBatch, setSelectedBatch] = useState<SettlementBatch | null>(DEMO_SETTLEMENTS[0]);
  const [payoutRequested, setPayoutRequested] = useState(false);

  const pendingGross = 38450;
  const platformFeeRate = 0.15;
  const pendingFee = Math.round(pendingGross * platformFeeRate);
  const pendingNet = pendingGross - pendingFee;

  return (
    <ConsoleLayout
      title="Payouts & Settlements"
      subtitle="Demo Preview: Simulated weekly disbursements, revenue reconciliation, and platform fee statements."
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        {/* Settlement Overview Metric Cards */}
        <div
          className="nabin-kpi-grid"
          style={{
            gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
          }}
        >
          <div className="nabin-stat-card">
            <div className="nabin-stat-card__top">
              <span className="nabin-stat-card__label">Pending Balance (Unsettled Demo)</span>
            </div>
            <div className="nabin-stat-card__value" style={{ color: 'var(--brand)' }}>
              ₹{pendingNet.toLocaleString('en-IN')}
            </div>
            <div className="nabin-stat-card__meta">
              Gross: ₹{pendingGross.toLocaleString('en-IN')} · Demo Cycle: Mon, Oct 12
            </div>
          </div>

          <div className="nabin-stat-card">
            <div className="nabin-stat-card__top">
              <span className="nabin-stat-card__label">Lifetime Settlements Paid (Demo)</span>
            </div>
            <div className="nabin-stat-card__value" style={{ color: 'var(--success-ink)' }}>
              ₹{(193704).toLocaleString('en-IN')}
            </div>
            <div className="nabin-stat-card__meta">
              3 Sample Batches Reconciled
            </div>
          </div>

          <div className="nabin-stat-card">
            <div className="nabin-stat-card__top">
              <span className="nabin-stat-card__label">Active Settlement Tier</span>
            </div>
            <div className="nabin-stat-card__value">
              15% Standard
            </div>
            <div className="nabin-stat-card__meta">
              Standard commission rate (Demo configuration)
            </div>
          </div>
        </div>

        {/* Bank Account Details Banner - Unconfigured State */}
        <div
          style={{
            background: '#F8FAFC',
            border: '1px solid #CBD5E1',
            borderRadius: 12,
            padding: '16px 20px',
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 16,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <span style={{ fontSize: 28 }}>🏦</span>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <strong style={{ fontSize: 15, color: '#0F172A' }}>Disbursement Bank Account</strong>
                <span
                  style={{
                    background: '#FEF3C7',
                    color: '#92400E',
                    fontSize: 11,
                    fontWeight: 700,
                    padding: '2px 8px',
                    borderRadius: 999,
                  }}
                >
                  UNCONFIGURED (DEMO PREVIEW)
                </span>
              </div>
              <div style={{ fontSize: 12, color: '#64748B', marginTop: 2 }}>
                No production banking gateway is connected. Automated disbursements are not configured in this preview environment.
              </div>
            </div>
          </div>

          <div>
            <button
              type="button"
              onClick={() => setPayoutRequested(true)}
              style={{
                background: payoutRequested ? '#22A447' : '#1A3BA2',
                color: '#FFFFFF',
                border: 'none',
                borderRadius: 8,
                padding: '9px 16px',
                fontSize: 13,
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              {payoutRequested ? 'Simulation Queued (Demo)' : 'Simulate Settlement (Demo)'}
            </button>
          </div>
        </div>

        {/* Historical Batches Table & Details */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 2fr) minmax(320px, 1.2fr)',
            gap: 20,
            alignItems: 'start',
          }}
        >
          {/* Batches Table */}
          <div className="nabin-card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '18px 22px', borderBottom: '1px solid var(--divider)' }}>
              <h3 style={{ fontSize: 16, fontWeight: 800, margin: 0, color: 'var(--ink)' }}>
                Disbursement History
              </h3>
            </div>

            <div className="nabin-table-wrap" style={{ border: 'none', borderRadius: 0 }}>
              <table className="nabin-table">
                <thead>
                  <tr>
                    <th>Period</th>
                    <th>Orders</th>
                    <th>Gross Total</th>
                    <th>Net Disbursed</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {settlements.map((s) => {
                    const isSelected = selectedBatch?.id === s.id;
                    return (
                      <tr
                        key={s.id}
                        onClick={() => setSelectedBatch(s)}
                        style={{
                          background: isSelected ? 'var(--brand-tint)' : 'transparent',
                          cursor: 'pointer',
                        }}
                      >
                        <td style={{ fontWeight: 600 }}>
                          <div>{s.period}</div>
                          <div style={{ fontSize: 11, color: 'var(--ink-muted)', fontFamily: 'monospace' }}>{s.id}</div>
                        </td>
                        <td style={{ color: 'var(--ink-muted)' }}>{s.orderCount} orders</td>
                        <td style={{ color: 'var(--ink-muted)' }}>
                          ₹{s.grossAmount.toLocaleString('en-IN')}
                        </td>
                        <td style={{ fontWeight: 800, color: 'var(--success-ink)' }}>
                          ₹{s.netPayout.toLocaleString('en-IN')}
                        </td>
                        <td>
                          <span className="nabin-badge nabin-badge--success" style={{ fontSize: 11 }}>
                            {s.status} (DEMO)
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Selected Batch Statement Breakdown */}
          {selectedBatch && (
            <div className="nabin-card" style={{ padding: 22 }}>
              <h3 style={{ fontSize: 16, fontWeight: 800, margin: '0 0 16px', color: 'var(--ink)' }}>
                Batch Statement: {selectedBatch.id}
              </h3>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, fontSize: 13 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', color: '#64748B' }}>
                  <span>Disbursement Date:</span>
                  <span style={{ fontWeight: 600, color: '#0F172A' }}>
                    {new Date(selectedBatch.settledAt).toLocaleDateString()}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', color: '#64748B' }}>
                  <span>Reference ID:</span>
                  <span style={{ fontFamily: 'monospace', color: '#1A3BA2', fontWeight: 600 }}>
                    {selectedBatch.reference}
                  </span>
                </div>

                <hr style={{ border: 'none', borderTop: '1px solid #E2E8F0', margin: '4px 0' }} />

                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>Gross Sales Total:</span>
                  <span style={{ fontWeight: 700 }}>₹{selectedBatch.grossAmount.toLocaleString('en-IN')}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', color: '#DC2626' }}>
                  <span>Platform Fee (15%):</span>
                  <span>- ₹{selectedBatch.platformFee.toLocaleString('en-IN')}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', color: '#DC2626' }}>
                  <span>Withholding Tax (1% TDS):</span>
                  <span>- ₹{selectedBatch.taxDeducted.toLocaleString('en-IN')}</span>
                </div>

                <hr style={{ border: 'none', borderTop: '1px solid #E2E8F0', margin: '4px 0' }} />

                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 16, fontWeight: 900 }}>
                  <span style={{ color: '#0F172A' }}>Net Payout (Demo):</span>
                  <span style={{ color: '#166534' }}>₹{selectedBatch.netPayout.toLocaleString('en-IN')}</span>
                </div>
              </div>

              <div style={{ marginTop: 20 }}>
                <button
                  type="button"
                  onClick={() => alert(`Downloaded PDF invoice for settlement batch ${selectedBatch.id}`)}
                  style={{
                    width: '100%',
                    background: '#F1F5F9',
                    border: '1px solid #CBD5E1',
                    borderRadius: 8,
                    padding: '9px',
                    fontSize: 13,
                    fontWeight: 700,
                    color: '#1E293B',
                    cursor: 'pointer',
                  }}
                >
                  Download Statement PDF
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </ConsoleLayout>
  );
}
