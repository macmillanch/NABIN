'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMerchant } from '@/context/MerchantAuth';

type BusinessType = 'RESTAURANT' | 'GROCERY' | 'BOTH';

export default function RegisterPage() {
  const { registerMerchant, error: authError } = useMerchant();

  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [businessType, setBusinessType] = useState<BusinessType>('BOTH');

  // Owner details
  const [ownerName, setOwnerName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');

  // Business details
  const [businessName, setBusinessName] = useState('');
  const [address, setAddress] = useState('');
  const [cuisines, setCuisines] = useState('');
  const [fssaiLicense, setFssaiLicense] = useState('');
  const [prepTime, setPrepTime] = useState('25');
  const [serviceRadius, setServiceRadius] = useState('5');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const handleNextStep1 = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setStep(2);
  };

  const handleNextStep2 = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!ownerName.trim()) {
      setError('Please provide the full legal name of the owner or store manager.');
      return;
    }
    const rawDigits = phone.replace(/\D/g, '');
    if (rawDigits.length < 10) {
      setError('Please provide a valid 10-digit Indian mobile number (+91).');
      return;
    }
    setStep(3);
  };

  const handleNextStep3 = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!businessName.trim()) {
      setError('Please specify your store or restaurant operating name.');
      return;
    }
    if (!address.trim()) {
      setError('Store physical operating address is mandatory.');
      return;
    }
    setStep(4);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);

    try {
      await registerMerchant({
        name: businessName.trim() || `${ownerName.trim()}'s Store`,
        phone: phone.trim(),
        address: address.trim(),
        businessType,
        ownerName: ownerName.trim(),
        email: email.trim() || undefined,
        fssaiLicense: fssaiLicense.trim() || undefined,
      });

      setSuccess(true);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Registration failed. Please try again.';
      setError(msg);
    } finally {
      setBusy(false);
    }
  };

  const getBusinessLabel = () => {
    if (businessType === 'RESTAURANT') return '🍽️ Restaurant Partner (Food Delivery & Kitchen)';
    if (businessType === 'GROCERY') return '🛒 Grocery Partner (Darkstore & Quick Commerce)';
    return '⚡ Restaurant + Grocery Hybrid (Both Services)';
  };

  return (
    <div className="nabin-auth">
      <div className="nabin-card nabin-auth__card nabin-auth__card--wide">
        <div style={{ textAlign: 'center', marginBottom: 'var(--space-md)' }}>
          <div style={{ marginBottom: 12 }}>
            <img
              src="/nabin_logo_full.png"
              alt="NABIN"
              style={{ height: 38, width: 'auto', margin: '0 auto', display: 'inline-block' }}
            />
          </div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: 'var(--ink)' }}>
            Merchant Partner Onboarding
          </h1>
          <p className="nabin-auth__subtitle" style={{ marginTop: 4 }}>
            Register your store for food delivery, grocery quick commerce, or both
          </p>
        </div>

        {/* Step progress indicator */}
        {!success && (
          <div style={{ marginBottom: 'var(--space-lg)' }}>
            <div
              style={{
                display: 'flex',
                gap: 'var(--space-xs)',
                marginBottom: 8,
              }}
            >
              {[1, 2, 3, 4].map((s) => (
                <div
                  key={s}
                  style={{
                    flex: 1,
                    height: 4,
                    borderRadius: 2,
                    background: step >= s ? 'var(--brand)' : 'var(--divider)',
                    transition: 'background 0.2s ease',
                  }}
                />
              ))}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--ink-muted)', fontWeight: 600 }}>
              <span style={{ color: step >= 1 ? 'var(--brand)' : undefined }}>1. Model</span>
              <span style={{ color: step >= 2 ? 'var(--brand)' : undefined }}>2. Owner</span>
              <span style={{ color: step >= 3 ? 'var(--brand)' : undefined }}>3. Store</span>
              <span style={{ color: step >= 4 ? 'var(--brand)' : undefined }}>4. Review</span>
            </div>
          </div>
        )}

        {/* Success View */}
        {success ? (
          <div style={{ textAlign: 'center', padding: 'var(--space-md) 0' }}>
            <div style={{ fontSize: 56, marginBottom: 'var(--space-md)' }}>🎉</div>
            <h2 style={{ fontSize: 20, fontWeight: 800, color: 'var(--ink)' }}>
              Registration Submitted Successfully!
            </h2>
            <div
              style={{
                background: '#EBF1FF',
                border: '1px solid #C9DAFF',
                borderRadius: 'var(--radius-md)',
                padding: 'var(--space-md)',
                marginTop: 'var(--space-md)',
                marginBottom: 'var(--space-lg)',
                textAlign: 'left',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', marginBottom: 8 }}>
                <span className="nabin-badge nabin-badge--brand">Account Created</span>
                <span style={{ fontWeight: 700, fontSize: 14 }}>{businessName}</span>
              </div>
              <p style={{ fontSize: 13, color: '#1A3BA2', margin: 0, lineHeight: 1.5 }}>
                Your merchant account is now enrolled in the NABIN ecosystem with business capability:{' '}
                <strong>{businessType}</strong>. You can sign in immediately using your registered mobile number and OTP.
              </p>
            </div>

            <div style={{ display: 'flex', gap: 'var(--space-sm)' }}>
              <Link
                href={`/login?phone=${encodeURIComponent(phone.trim())}`}
                className="nabin-btn nabin-btn--primary"
                style={{ flex: 1, justifyContent: 'center' }}
              >
                Sign In to Merchant Portal &rarr;
              </Link>
            </div>
          </div>
        ) : (
          <>
            {(error || authError) && (
              <div className="nabin-alert nabin-alert--danger" role="alert" style={{ marginBottom: 'var(--space-md)' }}>
                <span>{error || authError}</span>
              </div>
            )}

            {/* STEP 1: BUSINESS MODEL SELECTION */}
            {step === 1 && (
              <form onSubmit={handleNextStep1} className="nabin-form">
                <div>
                  <h2 style={{ fontSize: 16, fontWeight: 800, marginBottom: 'var(--space-sm)' }}>
                    Choose Your Store Category
                  </h2>
                  <p style={{ fontSize: 13, color: 'var(--ink-muted)', marginBottom: 'var(--space-md)' }}>
                    Select which services your business will offer on NABIN. You can manage one or both from a single unified portal.
                  </p>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
                    {/* Option 1: Restaurant */}
                    <label
                      style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: 'var(--space-md)',
                        padding: 'var(--space-md)',
                        borderRadius: 'var(--radius-md)',
                        border: `2px solid ${
                          businessType === 'RESTAURANT' ? 'var(--brand)' : 'var(--border)'
                        }`,
                        background:
                          businessType === 'RESTAURANT' ? '#F4F7FF' : 'var(--surface)',
                        cursor: 'pointer',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      <input
                        type="radio"
                        name="businessType"
                        value="RESTAURANT"
                        checked={businessType === 'RESTAURANT'}
                        onChange={() => setBusinessType('RESTAURANT')}
                        style={{ marginTop: 3, accentColor: 'var(--brand)' }}
                      />
                      <div>
                        <div style={{ fontWeight: 800, fontSize: 15, color: 'var(--ink)' }}>
                          🍽️ Restaurant
                        </div>
                        <p style={{ fontSize: 13, color: 'var(--ink-muted)', marginTop: 2 }}>
                          Manage food menus, dish availability, kitchen tickets, and hot meal preparation.
                        </p>
                      </div>
                    </label>

                    {/* Option 2: Grocery */}
                    <label
                      style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: 'var(--space-md)',
                        padding: 'var(--space-md)',
                        borderRadius: 'var(--radius-md)',
                        border: `2px solid ${
                          businessType === 'GROCERY' ? 'var(--brand)' : 'var(--border)'
                        }`,
                        background:
                          businessType === 'GROCERY' ? '#F4F7FF' : 'var(--surface)',
                        cursor: 'pointer',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      <input
                        type="radio"
                        name="businessType"
                        value="GROCERY"
                        checked={businessType === 'GROCERY'}
                        onChange={() => setBusinessType('GROCERY')}
                        style={{ marginTop: 3, accentColor: 'var(--brand)' }}
                      />
                      <div>
                        <div style={{ fontWeight: 800, fontSize: 15, color: 'var(--ink)' }}>
                          🛒 Grocery & Darkstore
                        </div>
                        <p style={{ fontSize: 13, color: 'var(--ink-muted)', marginTop: 2 }}>
                          Manage grocery stock, product inventory, batch pricing, and instant packing.
                        </p>
                      </div>
                    </label>

                    {/* Option 3: Both */}
                    <label
                      style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: 'var(--space-md)',
                        padding: 'var(--space-md)',
                        borderRadius: 'var(--radius-md)',
                        border: `2px solid ${
                          businessType === 'BOTH' ? 'var(--brand)' : 'var(--border)'
                        }`,
                        background:
                          businessType === 'BOTH' ? '#F4F7FF' : 'var(--surface)',
                        cursor: 'pointer',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      <input
                        type="radio"
                        name="businessType"
                        value="BOTH"
                        checked={businessType === 'BOTH'}
                        onChange={() => setBusinessType('BOTH')}
                        style={{ marginTop: 3, accentColor: 'var(--brand)' }}
                      />
                      <div>
                        <div
                          style={{
                            fontWeight: 800,
                            fontSize: 15,
                            color: 'var(--ink)',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 'var(--space-xs)',
                          }}
                        >
                          ⚡ Restaurant + Grocery (Both)
                          <span className="nabin-badge nabin-badge--brand" style={{ fontSize: 10 }}>
                            Hybrid Store
                          </span>
                        </div>
                        <p style={{ fontSize: 13, color: 'var(--ink-muted)', marginTop: 2 }}>
                          Manage both restaurant dining/kitchen and grocery retail from one single
                          account with an active switcher.
                        </p>
                      </div>
                    </label>
                  </div>
                </div>

                <button
                  type="submit"
                  className="nabin-btn nabin-btn--primary"
                  style={{ width: '100%', marginTop: 'var(--space-md)' }}
                >
                  Continue to Owner Information &rarr;
                </button>
              </form>
            )}

            {/* STEP 2: OWNER & CONTACT DETAILS */}
            {step === 2 && (
              <form onSubmit={handleNextStep2} className="nabin-form">
                <div>
                  <h2 style={{ fontSize: 16, fontWeight: 800, marginBottom: 'var(--space-sm)' }}>
                    Owner & Sign-in Details
                  </h2>
                  <p style={{ fontSize: 13, color: 'var(--ink-muted)', marginBottom: 'var(--space-md)' }}>
                    This mobile number will be used to log in via one-time verification code.
                  </p>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
                    <div>
                      <label className="nabin-label" htmlFor="ownerName">
                        Owner / Manager Full Legal Name *
                      </label>
                      <input
                        id="ownerName"
                        className="nabin-input"
                        type="text"
                        value={ownerName}
                        onChange={(e) => setOwnerName(e.target.value)}
                        placeholder="e.g. Lalhmingliana Sailo"
                        required
                      />
                    </div>

                    <div>
                      <label className="nabin-label" htmlFor="phone">
                        Registered Mobile Number (India +91) *
                      </label>
                      <input
                        id="phone"
                        className="nabin-input"
                        type="tel"
                        inputMode="tel"
                        autoComplete="tel"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        placeholder="e.g. 9810234567"
                        required
                      />
                      <p style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: 4 }}>
                        We will send a one-time login OTP to this phone.
                      </p>
                    </div>

                    <div>
                      <label className="nabin-label" htmlFor="email">
                        Contact Email Address (Optional)
                      </label>
                      <input
                        id="email"
                        className="nabin-input"
                        type="email"
                        autoComplete="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="owner@example.com"
                      />
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 'var(--space-sm)', marginTop: 'var(--space-md)' }}>
                  <button
                    type="button"
                    onClick={() => setStep(1)}
                    className="nabin-btn nabin-btn--ghost"
                    style={{ flex: 1 }}
                  >
                    &larr; Back
                  </button>
                  <button
                    type="submit"
                    className="nabin-btn nabin-btn--primary"
                    style={{ flex: 2 }}
                  >
                    Continue to Store Details &rarr;
                  </button>
                </div>
              </form>
            )}

            {/* STEP 3: BUSINESS & STORE DETAILS */}
            {step === 3 && (
              <form onSubmit={handleNextStep3} className="nabin-form">
                <div>
                  <h2 style={{ fontSize: 16, fontWeight: 800, marginBottom: 'var(--space-sm)' }}>
                    Store Details & Operating Address
                  </h2>
                  <p style={{ fontSize: 13, color: 'var(--ink-muted)', marginBottom: 'var(--space-md)' }}>
                    Public store details and physical location in Mizoram.
                  </p>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
                    <div>
                      <label className="nabin-label" htmlFor="businessName">
                        {businessType === 'RESTAURANT'
                          ? 'Restaurant Display Name *'
                          : businessType === 'GROCERY'
                            ? 'Grocery Store Display Name *'
                            : 'Business / Hybrid Store Display Name *'}
                      </label>
                      <input
                        id="businessName"
                        className="nabin-input"
                        type="text"
                        value={businessName}
                        onChange={(e) => setBusinessName(e.target.value)}
                        placeholder="e.g. Zarkawt Fresh Kitchen & Mart"
                        required
                      />
                    </div>

                    {(businessType === 'RESTAURANT' || businessType === 'BOTH') && (
                      <div className="nabin-grid" style={{ gridTemplateColumns: '2fr 1fr', gap: 'var(--space-sm)' }}>
                        <div>
                          <label className="nabin-label" htmlFor="cuisines">
                            Primary Cuisines / Specialties
                          </label>
                          <input
                            id="cuisines"
                            className="nabin-input"
                            type="text"
                            value={cuisines}
                            onChange={(e) => setCuisines(e.target.value)}
                            placeholder="e.g. Mizo, Fast Food, Chinese"
                          />
                        </div>
                        <div>
                          <label className="nabin-label">Prep Time</label>
                          <select
                            className="nabin-select"
                            value={prepTime}
                            onChange={(e) => setPrepTime(e.target.value)}
                          >
                            <option value="15">15 min</option>
                            <option value="25">25 min</option>
                            <option value="35">35 min</option>
                          </select>
                        </div>
                      </div>
                    )}

                    {(businessType === 'GROCERY' || businessType === 'BOTH') && (
                      <div>
                        <label className="nabin-label">Quick Commerce Service Radius</label>
                        <select
                          className="nabin-select"
                          value={serviceRadius}
                          onChange={(e) => setServiceRadius(e.target.value)}
                        >
                          <option value="3">3 km (Instant 15-minute fulfillment)</option>
                          <option value="5">5 km (Standard 30-minute radius)</option>
                          <option value="8">8 km (City wide darkstore)</option>
                        </select>
                      </div>
                    )}

                    <div>
                      <label className="nabin-label" htmlFor="address">
                        Physical Store Address *
                      </label>
                      <textarea
                        id="address"
                        className="nabin-input"
                        rows={2}
                        value={address}
                        onChange={(e) => setAddress(e.target.value)}
                        placeholder="Building / Street name, Area, City (e.g. Chanmari, Aizawl)"
                        required
                      />
                    </div>

                    <div>
                      <label className="nabin-label" htmlFor="fssaiLicense">
                        FSSAI License / Registration Number
                      </label>
                      <input
                        id="fssaiLicense"
                        className="nabin-input"
                        type="text"
                        value={fssaiLicense}
                        onChange={(e) => setFssaiLicense(e.target.value)}
                        placeholder="14-digit FSSAI Number (e.g. 10020030040050)"
                      />
                      <p style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: 4 }}>
                        Required for food safety compliance. Can also be submitted later in Profile.
                      </p>
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 'var(--space-sm)', marginTop: 'var(--space-md)' }}>
                  <button
                    type="button"
                    onClick={() => setStep(2)}
                    className="nabin-btn nabin-btn--ghost"
                    style={{ flex: 1 }}
                  >
                    &larr; Back
                  </button>
                  <button
                    type="submit"
                    className="nabin-btn nabin-btn--primary"
                    style={{ flex: 2 }}
                  >
                    Review Application &rarr;
                  </button>
                </div>
              </form>
            )}

            {/* STEP 4: REVIEW & CONFIRMATION */}
            {step === 4 && (
              <form onSubmit={handleSubmit} className="nabin-form">
                <div>
                  <h2 style={{ fontSize: 16, fontWeight: 800, marginBottom: 'var(--space-sm)' }}>
                    Review Application Summary
                  </h2>
                  <p style={{ fontSize: 13, color: 'var(--ink-muted)', marginBottom: 'var(--space-md)' }}>
                    Please verify your business information before submitting for onboarding.
                  </p>

                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 'var(--space-sm)',
                      background: 'var(--bg-subtle)',
                      borderRadius: 'var(--radius-md)',
                      padding: 'var(--space-md)',
                      border: '1px solid var(--border)',
                    }}
                  >
                    <div>
                      <span className="nabin-cell-meta">Selected Business Model</span>
                      <p style={{ fontWeight: 800, fontSize: 14, margin: 0 }}>{getBusinessLabel()}</p>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-md)' }}>
                      <div>
                        <span className="nabin-cell-meta">Store Display Name</span>
                        <p style={{ fontWeight: 700, margin: 0 }}>{businessName}</p>
                      </div>
                      <div>
                        <span className="nabin-cell-meta">Owner Name</span>
                        <p style={{ fontWeight: 700, margin: 0 }}>{ownerName}</p>
                      </div>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-md)' }}>
                      <div>
                        <span className="nabin-cell-meta">Registered Mobile</span>
                        <p style={{ fontWeight: 700, margin: 0 }}>+91 {phone.replace(/\D/g, '')}</p>
                      </div>
                      <div>
                        <span className="nabin-cell-meta">FSSAI License</span>
                        <p style={{ fontWeight: 700, margin: 0 }}>
                          {fssaiLicense.trim() || 'Pending verification'}
                        </p>
                      </div>
                    </div>

                    <div>
                      <span className="nabin-cell-meta">Operating Address</span>
                      <p style={{ fontSize: 13, margin: 0 }}>{address}</p>
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 'var(--space-sm)', marginTop: 'var(--space-md)' }}>
                  <button
                    type="button"
                    onClick={() => setStep(3)}
                    className="nabin-btn nabin-btn--ghost"
                    style={{ flex: 1 }}
                    disabled={busy}
                  >
                    &larr; Back
                  </button>
                  <button
                    type="submit"
                    className="nabin-btn nabin-btn--primary"
                    style={{ flex: 2 }}
                    disabled={busy}
                  >
                    {busy ? 'Registering Store…' : 'Submit & Register Store'}
                  </button>
                </div>
              </form>
            )}

            <div
              style={{
                marginTop: 'var(--space-lg)',
                paddingTop: 'var(--space-md)',
                borderTop: '1px solid var(--divider)',
                textAlign: 'center',
                fontSize: 13,
                color: 'var(--ink-muted)',
              }}
            >
              Already registered as a partner?{' '}
              <Link href="/login" style={{ color: 'var(--brand)', fontWeight: 700 }}>
                Sign In to Portal &rarr;
              </Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
