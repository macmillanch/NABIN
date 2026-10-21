'use client';

import { useState } from 'react';
import Link from 'next/link';
import ConsoleLayout from '@/components/ConsoleLayout';
import {
  CheckCircleIcon,
  SettingsIcon,
  ShoppingBagIcon,
  StoreIcon,
  UtensilsIcon,
} from '@/components/Icons';
import { useMerchant } from '@/context/MerchantAuth';

export default function SettingsPage() {
  const { merchant, loading, isHybrid, hasRestaurant, hasGrocery, activeContext } = useMerchant();

  const [isOpen, setIsOpen] = useState(merchant?.is_open ?? true);
  const [autoAccept, setAutoAccept] = useState(false);
  const [prepBuffer, setPrepBuffer] = useState('25');
  const [deliveryRadius, setDeliveryRadius] = useState('5');
  const [soundAlerts, setSoundAlerts] = useState(true);
  const [smsSummary, setSmsSummary] = useState(true);
  const [savedNotice, setSavedNotice] = useState('');

  if (loading || !merchant) {
    return <div className="nabin-skeleton" style={{ minHeight: '100vh', border: 'none' }} />;
  }

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    setSavedNotice('Store operational preferences saved successfully.');
    setTimeout(() => setSavedNotice(''), 4000);
  };

  return (
    <ConsoleLayout title="Store Settings & Operations">
      <div className="nabin-stack" style={{ maxWidth: 960 }}>
        <div className="nabin-page-head">
          <div>
            <h1>Store Preferences & Operations</h1>
            <p>Manage store availability, kitchen pacing, delivery radius, and notifications.</p>
          </div>
        </div>

        {savedNotice && (
          <div className="nabin-alert nabin-alert--success" role="status">
            <span>✅ {savedNotice}</span>
          </div>
        )}

        <form onSubmit={handleSave} className="nabin-stack" style={{ gap: 'var(--space-lg)' }}>
          {/* Store Availability Card */}
          <section className="nabin-card">
            <header className="nabin-card__header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 10,
                    background: isOpen ? '#dcfce7' : 'var(--surface-muted)',
                    color: isOpen ? '#166534' : 'var(--ink-muted)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <StoreIcon size={18} />
                </div>
                <div>
                  <h2 style={{ fontSize: 18, fontWeight: 800, color: 'var(--ink)' }}>Store Operating Status</h2>
                  <p className="nabin-cell-meta">Control whether your storefront accepts live customer orders.</p>
                </div>
              </div>
              <span className={`nabin-badge ${isOpen ? 'nabin-badge--success' : 'nabin-badge--danger'}`}>
                {isOpen ? '● Live & Accepting' : '○ Store Offline / Paused'}
              </span>
            </header>

            <div style={{ marginTop: 'var(--space-md)' }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '16px 20px',
                  borderRadius: 'var(--radius-md)',
                  background: isOpen ? 'linear-gradient(180deg, #f0fdf4 0%, #ffffff 100%)' : 'var(--surface-muted)',
                  border: `1.5px solid ${isOpen ? '#86efac' : 'var(--divider)'}`,
                }}
              >
                <div>
                  <span style={{ fontWeight: 800, display: 'block', fontSize: 15, color: 'var(--ink)' }}>
                    Accept Live Incoming Orders
                  </span>
                  <span className="nabin-cell-meta" style={{ marginTop: 2, display: 'block' }}>
                    When toggled off, customers in your delivery zone will see the store marked closed.
                  </span>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={isOpen}
                  onClick={() => setIsOpen(!isOpen)}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 8,
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    padding: '4px',
                  }}
                >
                  <div
                    style={{
                      width: 44,
                      height: 24,
                      borderRadius: 12,
                      background: isOpen ? 'var(--success)' : '#cbd5e1',
                      position: 'relative',
                      transition: 'background 0.2s ease',
                    }}
                  >
                    <div
                      style={{
                        width: 18,
                        height: 18,
                        borderRadius: '50%',
                        background: '#ffffff',
                        position: 'absolute',
                        top: 3,
                        left: isOpen ? 23 : 3,
                        transition: 'left 0.2s ease',
                        boxShadow: '0 1px 3px rgba(0,0,0,0.25)',
                      }}
                    />
                  </div>
                </button>
              </div>
            </div>
          </section>

          {/* Business-Specific Operations */}
          {(hasRestaurant || isHybrid) && (activeContext === 'ALL' || activeContext === 'RESTAURANT') && (
            <section className="nabin-card">
              <header className="nabin-card__header">
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 10,
                      background: 'var(--brand-tint)',
                      color: 'var(--brand)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <UtensilsIcon size={18} />
                  </div>
                  <div>
                    <h2 style={{ fontSize: 18, fontWeight: 800, color: 'var(--ink)' }}>
                      Restaurant & Kitchen Operations
                    </h2>
                    <p className="nabin-cell-meta">Configure meal prep buffers and kitchen ticket acceptance.</p>
                  </div>
                </div>
              </header>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
                  gap: 'var(--space-md)',
                  marginTop: 'var(--space-md)',
                }}
              >
                <div>
                  <label className="nabin-label" htmlFor="prep-buffer-select">
                    Default Food Preparation Time
                  </label>
                  <select
                    id="prep-buffer-select"
                    className="nabin-select"
                    value={prepBuffer}
                    onChange={(e) => setPrepBuffer(e.target.value)}
                  >
                    <option value="15">15 Minutes (Fast Food / Quick Bites)</option>
                    <option value="25">25 Minutes (Standard Kitchen)</option>
                    <option value="35">35 Minutes (Specialty / Biryani)</option>
                    <option value="45">45 Minutes (Gourmet / Extended Platters)</option>
                  </select>
                </div>

                <div>
                  <label className="nabin-label" htmlFor="auto-accept-select">
                    Kitchen Order Ingestion
                  </label>
                  <select
                    id="auto-accept-select"
                    className="nabin-select"
                    value={autoAccept ? 'yes' : 'no'}
                    onChange={(e) => setAutoAccept(e.target.value === 'yes')}
                  >
                    <option value="no">Manual Review (Kitchen reviews and accepts ticket)</option>
                    <option value="yes">Auto-Accept (Instantly transitions to PREPARING)</option>
                  </select>
                </div>
              </div>
            </section>
          )}

          {(hasGrocery || isHybrid) && (activeContext === 'ALL' || activeContext === 'GROCERY') && (
            <section className="nabin-card">
              <header className="nabin-card__header">
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 10,
                      background: 'var(--brand-tint)',
                      color: 'var(--brand)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <ShoppingBagIcon size={18} />
                  </div>
                  <div>
                    <h2 style={{ fontSize: 18, fontWeight: 800, color: 'var(--ink)' }}>
                      Grocery Quick Commerce Fulfillment
                    </h2>
                    <p className="nabin-cell-meta">Manage instant grocery delivery radius and packing standards.</p>
                  </div>
                </div>
              </header>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
                  gap: 'var(--space-md)',
                  marginTop: 'var(--space-md)',
                }}
              >
                <div>
                  <label className="nabin-label" htmlFor="delivery-radius-select">
                    Delivery Service Radius
                  </label>
                  <select
                    id="delivery-radius-select"
                    className="nabin-select"
                    value={deliveryRadius}
                    onChange={(e) => setDeliveryRadius(e.target.value)}
                  >
                    <option value="3">3 km (Hyperlocal 15-minute dispatch)</option>
                    <option value="5">5 km (Standard 30-minute delivery)</option>
                    <option value="8">8 km (City wide darkstore coverage)</option>
                    <option value="12">12 km (Extended regional coverage)</option>
                  </select>
                </div>

                <div>
                  <label className="nabin-label" htmlFor="scale-verify-input">
                    Weight Verification Requirement
                  </label>
                  <input
                    id="scale-verify-input"
                    type="text"
                    className="nabin-input"
                    value="Mandatory Digital Scale Reading on Pack"
                    readOnly
                    style={{ background: 'var(--surface-muted)' }}
                  />
                </div>
              </div>
            </section>
          )}

          {/* Notifications & Hardware */}
          <section className="nabin-card">
            <header className="nabin-card__header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 10,
                    background: 'var(--surface-muted)',
                    color: 'var(--ink)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <SettingsIcon size={18} />
                </div>
                <div>
                  <h2 style={{ fontSize: 18, fontWeight: 800, color: 'var(--ink)' }}>
                    Alert & Audio Notifications
                  </h2>
                  <p className="nabin-cell-meta">Audio chimes and real-time operational notifications.</p>
                </div>
              </div>
            </header>

            <div className="nabin-stack" style={{ gap: 'var(--space-sm)', marginTop: 'var(--space-md)' }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '12px 16px',
                  borderRadius: 'var(--radius-md)',
                  background: 'var(--surface-muted)',
                  border: '1px solid var(--divider)',
                }}
              >
                <div>
                  <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--ink)' }}>
                    Audible Kitchen / Order Chime
                  </span>
                  <span className="nabin-cell-meta" style={{ display: 'block', fontSize: 12 }}>
                    Plays repeating alert chime until ticket is acknowledged
                  </span>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={soundAlerts}
                  onClick={() => setSoundAlerts(!soundAlerts)}
                  style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 4 }}
                >
                  <div
                    style={{
                      width: 40,
                      height: 22,
                      borderRadius: 11,
                      background: soundAlerts ? 'var(--brand)' : '#cbd5e1',
                      position: 'relative',
                      transition: 'background 0.2s',
                    }}
                  >
                    <div
                      style={{
                        width: 16,
                        height: 16,
                        borderRadius: '50%',
                        background: '#ffffff',
                        position: 'absolute',
                        top: 3,
                        left: soundAlerts ? 21 : 3,
                        transition: 'left 0.2s',
                      }}
                    />
                  </div>
                </button>
              </div>

              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '12px 16px',
                  borderRadius: 'var(--radius-md)',
                  background: 'var(--surface-muted)',
                  border: '1px solid var(--divider)',
                }}
              >
                <div>
                  <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--ink)' }}>
                    Daily Payout & Settlement SMS
                  </span>
                  <span className="nabin-cell-meta" style={{ display: 'block', fontSize: 12 }}>
                    Receive nightly settlement summary of completed order GMV
                  </span>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={smsSummary}
                  onClick={() => setSmsSummary(!smsSummary)}
                  style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 4 }}
                >
                  <div
                    style={{
                      width: 40,
                      height: 22,
                      borderRadius: 11,
                      background: smsSummary ? 'var(--brand)' : '#cbd5e1',
                      position: 'relative',
                      transition: 'background 0.2s',
                    }}
                  >
                    <div
                      style={{
                        width: 16,
                        height: 16,
                        borderRadius: '50%',
                        background: '#ffffff',
                        position: 'absolute',
                        top: 3,
                        left: smsSummary ? 21 : 3,
                        transition: 'left 0.2s',
                      }}
                    />
                  </div>
                </button>
              </div>
            </div>
          </section>

          {/* Sticky Save Bar */}
          <div
            className="nabin-card"
            style={{
              padding: '16px 20px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: 'var(--space-md)',
              background: '#ffffff',
            }}
          >
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)' }}>
                Apply Store Configuration
              </div>
              <div className="nabin-cell-meta" style={{ fontSize: 12 }}>
                Changes apply in real time across customer and delivery discovery.
              </div>
            </div>
            <div style={{ display: 'flex', gap: 'var(--space-sm)' }}>
              <Link href="/profile" className="nabin-btn nabin-btn--ghost" style={{ minHeight: 40 }}>
                View Profile
              </Link>
              <button
                type="submit"
                className="nabin-btn nabin-btn--primary"
                style={{ minHeight: 40, padding: '0 24px', fontWeight: 800 }}
              >
                Save Preferences
              </button>
            </div>
          </div>
        </form>
      </div>
    </ConsoleLayout>
  );
}
