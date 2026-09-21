'use client';

import { useState } from 'react';
import { useMerchant } from '@/context/MerchantAuth';

export default function LoginPage() {
  const { sendOtp, verifyOtp, error, devCode } = useMerchant();
  const [phone, setPhone] = useState('');
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
      /* the provider already recorded `error` */
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
        <p className="nabin-wordmark" style={{ fontSize: 26, textAlign: 'center' }}>
          NABIN
        </p>
        <p className="nabin-auth__subtitle">
          {step === 'phone'
            ? 'Partner sign in — grocery store console'
            : `We sent a code to ${phone}`}
        </p>

        {error && (
          <div className="nabin-alert nabin-alert--danger" role="alert">
            <span>{error}</span>
          </div>
        )}
        {notice && (
          <div className="nabin-alert nabin-alert--danger" role="alert">
            <span>{notice}</span>
          </div>
        )}

        {step === 'phone' ? (
          <form onSubmit={submitPhone} className="nabin-form">
            <div>
              <label className="nabin-label" htmlFor="phone">
                Registered partner phone
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
              />
            </div>
            <button type="submit" className="nabin-btn nabin-btn--primary" disabled={busy}>
              {busy ? 'Sending…' : 'Send code'}
            </button>
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
                <span>Development mode — the backend returned code {devCode}.</span>
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
              {busy ? 'Verifying…' : 'Enter store console'}
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
