'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ShoppingBagIcon, StoreIcon, UtensilsIcon } from '@/components/Icons';
import { useMerchant } from '@/context/MerchantAuth';

function LoginForm() {
  const { sendOtp, verifyOtp, error, devCode } = useMerchant();
  const searchParams = useSearchParams();
  const router = useRouter();

  const [phone, setPhone] = useState(() => searchParams.get('phone') || '');
  const [otp, setOtp] = useState('');
  const [step, setStep] = useState<'phone' | 'otp'>('phone');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');

  const submitPhone = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setNotice('');
    try {
      await sendOtp(phone);
      setStep('otp');
    } catch {
      /* error recorded by provider */
    } finally {
      setBusy(false);
    }
  };

  const submitOtp = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      await verifyOtp(phone, otp);
    } catch {
      setNotice('That code was not accepted. Request a new one if it has expired.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="nabin-auth">
      <div className="nabin-card nabin-auth__card">
        <div style={{ textAlign: 'center', marginBottom: 20 }}>
          <div style={{ marginBottom: 12 }}>
            <img
              src="/nabin_logo_full.png"
              alt="NABIN"
              style={{ height: 38, width: 'auto', margin: '0 auto', display: 'inline-block' }}
            />
          </div>
          <p style={{ fontSize: 13, color: 'var(--ink-muted)', marginTop: 4 }}>
            Unified Merchant Console &middot; Restaurant & Grocery
          </p>
        </div>

        {error && (
          <div className="nabin-alert nabin-alert--danger" role="alert" style={{ marginBottom: 16 }}>
            <span>{error}</span>
          </div>
        )}
        {notice && (
          <div className="nabin-alert nabin-alert--danger" role="alert" style={{ marginBottom: 16 }}>
            <span>{notice}</span>
          </div>
        )}

        {step === 'phone' ? (
          <form onSubmit={submitPhone} className="nabin-form">
            <div>
              <label className="nabin-label" htmlFor="phone" style={{ fontWeight: 700, fontSize: 13 }}>
                Registered Partner Mobile
              </label>
              <input
                id="phone"
                className="nabin-input"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+91 98765 43210"
                disabled={busy}
                required
                style={{ fontSize: 15 }}
              />
            </div>
            <button
              type="submit"
              className="nabin-btn nabin-btn--primary"
              disabled={busy}
              style={{ minHeight: 44, fontWeight: 800, fontSize: 15 }}
            >
              {busy ? 'Sending OTP…' : 'Send Verification Code'}
            </button>

            <div
              style={{
                marginTop: 16,
                paddingTop: 16,
                borderTop: '1px solid var(--divider)',
                textAlign: 'center',
                fontSize: 13,
                color: 'var(--ink-muted)',
              }}
            >
              New partner?{' '}
              <Link href="/register" style={{ color: 'var(--brand)', fontWeight: 800 }}>
                Register your business &rarr;
              </Link>
            </div>

            {/* Instant Demo Persona Switcher */}
            <div
              style={{
                marginTop: 20,
                paddingTop: 16,
                borderTop: '1px solid var(--divider)',
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}
            >
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 800,
                  color: 'var(--ink-muted)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                  textAlign: 'center',
                  marginBottom: 4,
                }}
              >
                Instant UI Preview (Demo Personas)
              </span>

              <button
                type="button"
                onClick={() => {
                  if (typeof window !== 'undefined') {
                    window.localStorage.setItem('nabin_merchant_token', 'demo-merchant-token');
                    window.localStorage.setItem('nabin_restaurant_merchant_token', 'demo-merchant-token');
                    window.localStorage.setItem('nabin_grocery_merchant_token', 'demo-merchant-token');
                    window.localStorage.setItem('nabin_merchant_active_context', 'ALL');
                    router.push('/');
                  }
                }}
                className="nabin-card"
                style={{
                  padding: '10px 14px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  cursor: 'pointer',
                  textAlign: 'left',
                  background: '#ffffff',
                  border: '1px solid var(--divider)',
                  transition: 'border-color 0.15s ease',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div
                    style={{
                      width: 30,
                      height: 30,
                      borderRadius: 8,
                      background: 'var(--brand-tint)',
                      color: 'var(--brand)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <StoreIcon size={16} />
                  </div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>
                      Hybrid Partner
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--ink-muted)' }}>Kitchen & Darkstore</div>
                  </div>
                </div>
                <span className="nabin-badge nabin-badge--brand-subtle" style={{ fontSize: 10 }}>
                  Preview &rarr;
                </span>
              </button>

              <button
                type="button"
                onClick={() => {
                  if (typeof window !== 'undefined') {
                    window.localStorage.setItem('nabin_merchant_token', 'demo-restaurant-token');
                    window.localStorage.setItem('nabin_restaurant_merchant_token', 'demo-restaurant-token');
                    window.localStorage.setItem('nabin_grocery_merchant_token', 'demo-restaurant-token');
                    window.localStorage.setItem('nabin_merchant_active_context', 'RESTAURANT');
                    router.push('/');
                  }
                }}
                className="nabin-card"
                style={{
                  padding: '10px 14px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  cursor: 'pointer',
                  textAlign: 'left',
                  background: '#ffffff',
                  border: '1px solid var(--divider)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div
                    style={{
                      width: 30,
                      height: 30,
                      borderRadius: 8,
                      background: '#fff7ed',
                      color: 'var(--food-orange)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <UtensilsIcon size={16} />
                  </div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>
                      Restaurant Partner
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--ink-muted)' }}>Food Kitchen Orders</div>
                  </div>
                </div>
                <span className="nabin-badge nabin-badge--warning" style={{ fontSize: 10 }}>
                  Preview &rarr;
                </span>
              </button>

              <button
                type="button"
                onClick={() => {
                  if (typeof window !== 'undefined') {
                    window.localStorage.setItem('nabin_merchant_token', 'demo-grocery-token');
                    window.localStorage.setItem('nabin_restaurant_merchant_token', 'demo-grocery-token');
                    window.localStorage.setItem('nabin_grocery_merchant_token', 'demo-grocery-token');
                    window.localStorage.setItem('nabin_merchant_active_context', 'GROCERY');
                    router.push('/');
                  }
                }}
                className="nabin-card"
                style={{
                  padding: '10px 14px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  cursor: 'pointer',
                  textAlign: 'left',
                  background: '#ffffff',
                  border: '1px solid var(--divider)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div
                    style={{
                      width: 30,
                      height: 30,
                      borderRadius: 8,
                      background: '#f0fdf4',
                      color: 'var(--grocery-green)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <ShoppingBagIcon size={16} />
                  </div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>
                      Grocery Partner
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--ink-muted)' }}>Darkstore & Retail</div>
                  </div>
                </div>
                <span className="nabin-badge nabin-badge--success" style={{ fontSize: 10 }}>
                  Preview &rarr;
                </span>
              </button>
            </div>
          </form>
        ) : (
          <form onSubmit={submitOtp} className="nabin-form">
            {devCode && (
              <div
                className="nabin-notice"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 'var(--space-sm)',
                  marginBottom: 0,
                }}
              >
                <span>Development mode — code: {devCode}</span>
                <button
                  type="button"
                  onClick={() => setOtp(devCode)}
                  className="nabin-btn nabin-btn--ghost"
                  style={{ minHeight: 32, padding: '0 var(--space-sm)' }}
                >
                  Fill code
                </button>
              </div>
            )}
            <div>
              <label className="nabin-label" htmlFor="otp">
                One-time code
              </label>
              <input
                id="otp"
                className="nabin-input nabin-input--otp"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
                placeholder="000000"
                disabled={busy}
                required
              />
            </div>
            <button type="submit" className="nabin-btn nabin-btn--primary" disabled={busy}>
              {busy ? 'Verifying…' : 'Enter merchant console'}
            </button>
            <button
              type="button"
              onClick={() => {
                setStep('phone');
                setOtp('');
                setNotice('');
              }}
              className="nabin-btn nabin-btn--ghost"
              disabled={busy}
            >
              Use a different number
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="nabin-skeleton" style={{ minHeight: '100vh', border: 'none' }} />}>
      <LoginForm />
    </Suspense>
  );
}
