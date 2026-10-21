'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import ConsoleLayout, { RESTAURANT_NAV } from '@/components/ConsoleLayout';
import { SettlementIcon } from '@/components/Icons';
import { useMerchant } from '@/context/MerchantAuth';
import { inr } from '@/lib/format';

export default function SettlementsPage() {
  const { merchant, loading } = useMerchant();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !merchant) router.replace('/login');
  }, [loading, merchant, router]);

  if (loading || !merchant) {
    return <div className="nabin-skeleton" style={{ minHeight: '100vh', border: 'none' }} />;
  }

  return (
    <ConsoleLayout title="Settlements & Payouts" roleLabel="Restaurant" nav={RESTAURANT_NAV}>
      <div className="nabin-stack">
        <header className="nabin-card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 900 }}>Merchant Settlement Account</h1>
            <p className="nabin-cell-meta">
              Authoritative financial ledger balance and payout cycles managed via NABIN Double-Entry Settlement.
            </p>
          </div>
        </header>

        <div className="nabin-grid">
          <div className="nabin-card">
            <p className="nabin-stat__label">Available Ledger Balance</p>
            <p className="nabin-stat__value nabin-num" style={{ color: '#1A3BA2' }}>
              {inr(merchant.wallet_balance || 0)}
            </p>
            <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
              Eligible for automated banking payout
            </p>
          </div>
          <div className="nabin-card">
            <p className="nabin-stat__label">Platform Commission Rate</p>
            <p className="nabin-stat__value nabin-num">
              {((merchant.commission_rate ?? 0.15) * 100).toFixed(1)}%
            </p>
            <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
              Contracted platform service fee
            </p>
          </div>
          <div className="nabin-card">
            <p className="nabin-stat__label">Next Settlement Payout</p>
            <p className="nabin-stat__value nabin-num" style={{ fontSize: 20 }}>
              Daily Cycle (T+1)
            </p>
            <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
              Direct NEFT/RTGS to registered bank account
            </p>
          </div>
        </div>

        <section className="nabin-card">
          <h2 style={{ fontSize: 17, fontWeight: 800, marginBottom: 12 }}>Settlement Security & Governance</h2>
          <div className="nabin-stack" style={{ gap: 10 }}>
            <p style={{ fontSize: 13, color: '#334155' }}>
              All restaurant transactions are recorded via NABIN&apos;s immutable double-entry ledger. Deductions include:
            </p>
            <ul style={{ paddingLeft: 20, fontSize: 13, color: '#475569', lineHeight: 1.6 }}>
              <li>Contracted NABIN Food platform commission on delivered orders.</li>
              <li>GST tax collections credited according to restaurant registration (FSSAI: {merchant.fssai_license || 'On record'}).</li>
              <li>Zero platform deduction on Dine-In and Cash collections recorded at the restaurant counter.</li>
            </ul>
          </div>
        </section>
      </div>
    </ConsoleLayout>
  );
}
