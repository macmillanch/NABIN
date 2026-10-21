'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import ConsoleLayout from '@/components/ConsoleLayout';
import {
  LogoutIcon,
  PhoneIcon,
  PinIcon,
  ShieldCheckIcon,
  ShoppingBagIcon,
  StoreIcon,
  UtensilsIcon,
} from '@/components/Icons';
import { useMerchant } from '@/context/MerchantAuth';
import { inr } from '@/lib/format';
import { humanise } from '@/lib/orderFlow';

export default function ProfilePage() {
  const { merchant, loading, merchantType, isHybrid, hasRestaurant, hasGrocery, logout } =
    useMerchant();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !merchant) router.replace('/login');
  }, [loading, merchant, router]);

  if (loading || !merchant) {
    return <div className="nabin-skeleton" style={{ minHeight: '100vh', border: 'none' }} />;
  }

  return (
    <ConsoleLayout title="Business Profile">
      <div className="nabin-stack">
        <div className="nabin-page-head" style={{ marginBottom: 0 }}>
          <div>
            <h1>Business Profile & Account</h1>
            <p>Authorized merchant details and platform compliance records.</p>
          </div>
        </div>

        {/* Core Identity Banner */}
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
                  width: 56,
                  height: 56,
                  borderRadius: 16,
                  background: 'var(--brand)',
                  color: '#ffffff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                  boxShadow: '0 4px 12px rgba(26, 59, 162, 0.25)',
                }}
              >
                <StoreIcon size={28} />
              </div>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <h2 style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.02em', color: 'var(--ink)' }}>
                    {merchant.name}
                  </h2>
                  <span
                    className={`nabin-badge ${
                      isHybrid ? 'nabin-badge--brand-subtle' : 'nabin-badge--neutral'
                    }`}
                  >
                    {isHybrid ? '⚡ Restaurant + Grocery Hybrid' : humanise(merchantType) || 'Merchant Partner'}
                  </span>
                </div>
                <p className="nabin-cell-meta" style={{ marginTop: 4, fontFamily: 'monospace', fontSize: 12 }}>
                  NABIN Account ID: {merchant.id}
                </p>
              </div>
            </div>

            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                padding: '6px 14px',
                borderRadius: 9999,
                background: merchant.is_open ? 'var(--success-tint)' : 'var(--surface-muted)',
                border: `1px solid ${merchant.is_open ? 'rgba(34, 164, 71, 0.3)' : 'var(--divider)'}`,
              }}
            >
              <div
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: merchant.is_open ? 'var(--success)' : 'var(--ink-muted)',
                }}
              />
              <span
                style={{
                  fontSize: 13,
                  fontWeight: 700,
                  color: merchant.is_open ? 'var(--success-ink)' : 'var(--ink-muted)',
                }}
              >
                {merchant.is_open ? 'Accepting Live Orders' : 'Store Offline'}
              </span>
            </div>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              gap: 'var(--space-lg)',
              marginTop: 'var(--space-lg)',
              paddingTop: 'var(--space-lg)',
              borderTop: '1px solid var(--divider)',
            }}
          >
            <div>
              <span className="nabin-cell-meta" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <PhoneIcon size={14} />
                <span>Registered Mobile Phone</span>
              </span>
              <div style={{ fontWeight: 700, fontSize: 15, marginTop: 4, color: 'var(--ink)' }}>
                {merchant.phone ?? '—'}
              </div>
            </div>

            <div>
              <span className="nabin-cell-meta" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <PinIcon size={14} />
                <span>Physical Store Address</span>
              </span>
              <div style={{ fontWeight: 600, fontSize: 14, marginTop: 4, color: 'var(--ink)' }}>
                {merchant.address ?? 'Registered location on file'}
              </div>
            </div>

            <div>
              <span className="nabin-cell-meta" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <ShieldCheckIcon size={14} />
                <span>FSSAI Food Safety Compliance</span>
              </span>
              <div style={{ fontWeight: 700, fontSize: 14, marginTop: 4 }}>
                {merchant.fssai_license ? (
                  <span style={{ color: 'var(--success-ink)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <span>Verified: {merchant.fssai_license}</span>
                  </span>
                ) : (
                  <span style={{ color: 'var(--warning-dark)' }}>⚠️ Pending Verification</span>
                )}
              </div>
            </div>

            <div>
              <span className="nabin-cell-meta">Settlement Wallet Balance</span>
              <div style={{ fontWeight: 900, fontSize: 18, marginTop: 4, color: 'var(--brand)' }}>
                {inr(merchant.wallet_balance ?? 0)}
              </div>
            </div>
          </div>
        </section>

        {/* Authorized Modules and Capabilities */}
        <section className="nabin-card">
          <header className="nabin-card__header">
            <div>
              <h3 style={{ fontSize: 18, fontWeight: 800, color: 'var(--ink)' }}>
                Service Capabilities & Operational Modules
              </h3>
              <p className="nabin-cell-meta">
                Role capabilities provisioned for this store based on active compliance credentials:
              </p>
            </div>
          </header>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
              gap: 'var(--space-md)',
              marginTop: 'var(--space-md)',
            }}
          >
            <div
              style={{
                padding: '20px',
                borderRadius: 'var(--radius-md)',
                border: `1.5px solid ${hasRestaurant ? '#86efac' : 'var(--divider)'}`,
                background: hasRestaurant ? 'linear-gradient(180deg, #f0fdf4 0%, #ffffff 100%)' : 'var(--surface-muted)',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 10,
                      background: hasRestaurant ? '#dcfce7' : 'var(--surface-emphasized)',
                      color: hasRestaurant ? '#166534' : 'var(--ink-muted)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <UtensilsIcon size={18} />
                  </div>
                  <span style={{ fontWeight: 800, fontSize: 16, color: 'var(--ink)' }}>
                    Restaurant Kitchen
                  </span>
                </div>
                <span
                  className={`nabin-badge ${
                    hasRestaurant ? 'nabin-badge--success' : 'nabin-badge--neutral'
                  }`}
                >
                  {hasRestaurant ? 'Authorized' : 'Disabled'}
                </span>
              </div>
              <p style={{ fontSize: 13, color: 'var(--ink-muted)', marginTop: 10, lineHeight: 1.5 }}>
                Enables live Kitchen Display System (KDS), dish menu catalog management, and instant restaurant food orders.
              </p>
            </div>

            <div
              style={{
                padding: '20px',
                borderRadius: 'var(--radius-md)',
                border: `1.5px solid ${hasGrocery ? '#86efac' : 'var(--divider)'}`,
                background: hasGrocery ? 'linear-gradient(180deg, #f0fdf4 0%, #ffffff 100%)' : 'var(--surface-muted)',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 10,
                      background: hasGrocery ? '#dcfce7' : 'var(--surface-emphasized)',
                      color: hasGrocery ? '#166534' : 'var(--ink-muted)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <ShoppingBagIcon size={18} />
                  </div>
                  <span style={{ fontWeight: 800, fontSize: 16, color: 'var(--ink)' }}>
                    Grocery Quick Commerce
                  </span>
                </div>
                <span
                  className={`nabin-badge ${
                    hasGrocery ? 'nabin-badge--success' : 'nabin-badge--neutral'
                  }`}
                >
                  {hasGrocery ? 'Authorized' : 'Disabled'}
                </span>
              </div>
              <p style={{ fontSize: 13, color: 'var(--ink-muted)', marginTop: 10, lineHeight: 1.5 }}>
                Enables retail darkstore inventory, scale weight confirmation on order packing, and fast dispatch operations.
              </p>
            </div>
          </div>
        </section>

        {/* Account Operations */}
        <section className="nabin-card">
          <header className="nabin-card__header">
            <div>
              <h3 style={{ fontSize: 18, fontWeight: 800, color: 'var(--ink)' }}>
                Account Operations
              </h3>
              <p className="nabin-cell-meta">Session management and portal access control.</p>
            </div>
          </header>
          <div style={{ marginTop: 'var(--space-md)' }}>
            <button
              type="button"
              className="nabin-btn nabin-btn--danger"
              onClick={logout}
              style={{ minHeight: 42, padding: '0 20px', gap: 8, fontWeight: 700 }}
            >
              <LogoutIcon size={16} />
              <span>Sign Out of Merchant Account</span>
            </button>
          </div>
        </section>
      </div>
    </ConsoleLayout>
  );
}
