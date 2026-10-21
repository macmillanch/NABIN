'use client';

import { useCallback, useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import ConsoleLayout, { RESTAURANT_NAV } from '@/components/ConsoleLayout';
import { RefreshIcon, SettingsIcon } from '@/components/Icons';
import { useMerchant } from '@/context/MerchantAuth';
import { rmsApi, type RmsSettings } from '@/lib/api';
import { toFailure } from '@/lib/format';

export default function SettingsPage() {
  const { merchant, loading } = useMerchant();
  const router = useRouter();
  const merchantId = merchant?.id;

  const [activeTab, setActiveTab] = useState<'channels' | 'payments'>('channels');

  const [settings, setSettings] = useState<RmsSettings>({
    dine_in_enabled: true,
    takeaway_enabled: true,
    delivery_enabled: true,
    tax_rate_percent: 5.0,
    service_charge_percent: 5.0,
    packaging_fee: 15.0,
    prep_time_minutes: 25,
    currency: 'INR',
    upi_id: '',
    upi_qr_url: '',
    upi_merchant_name: '',
    gstin: '',
  });

  // Dedicated payment tab states
  const [upiIdInput, setUpiIdInput] = useState('');
  const [upiQrPreview, setUpiQrPreview] = useState<string | null>(null);
  const [upiMerchantNameInput, setUpiMerchantNameInput] = useState('');
  const [gstinInput, setGstinInput] = useState('');
  const [qrFileError, setQrFileError] = useState('');
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [pending, setPending] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const loadSettings = useCallback(async () => {
    if (!merchantId) return;
    setPending(true);
    try {
      const res = await rmsApi.getSettings(merchantId);
      if (res.data.settings) {
        const s = res.data.settings;
        setSettings(s);
        setUpiIdInput(s.upi_id || s.upiId || '');
        setUpiQrPreview(s.upi_qr_url || s.upiQrUrl || null);
        setUpiMerchantNameInput(s.upi_merchant_name || s.upiMerchantName || '');
        setGstinInput(s.gstin || '');
      }
      setError('');
    } catch (err) {
      setError(toFailure(err, 'Failed to fetch RMS settings.').message);
    } finally {
      setPending(false);
    }
  }, [merchantId]);

  useEffect(() => {
    if (!loading && !merchant) router.replace('/login');
  }, [loading, merchant, router]);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  const handleSaveChannels = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!merchantId) return;
    setSaving(true);
    try {
      await rmsApi.updateSettings(merchantId, settings);
      setSuccessMsg('RMS channel & billing settings updated successfully.');
      setError('');
    } catch (err) {
      setError(toFailure(err, 'Failed to save settings.').message);
    } finally {
      setSaving(false);
    }
  };

  const handleQrFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setQrFileError('');
    const file = e.target.files?.[0];
    if (!file) return;

    const allowedTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
    if (!allowedTypes.includes(file.type.toLowerCase())) {
      setQrFileError('Unsupported file type. Please upload a genuine static QR in PNG, JPEG, or WebP format.');
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      setQrFileError('File size exceeds the 5MB limit. Please upload a smaller image.');
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const result = event.target?.result as string;
      setUpiQrPreview(result);
    };
    reader.onerror = () => {
      setQrFileError('Failed to read image file. Please try again.');
    };
    reader.readAsDataURL(file);
  };

  const handleRemoveQr = () => {
    setUpiQrPreview(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleSavePayments = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!merchantId) return;

    // Sensible format check
    if (upiIdInput.trim() && !/^[\w.\-_]{2,256}@[\w.\-_]{2,64}$/.test(upiIdInput.trim())) {
      setError("Invalid UPI ID format. Expected format like username@bank (e.g., 'restaurant@okhdfcbank').");
      return;
    }

    setSaving(true);
    setError('');
    try {
      await rmsApi.updatePaymentSettings(merchantId, {
        upiId: upiIdInput.trim() || null,
        upiQrUrl: upiQrPreview || null,
        upiMerchantName: upiMerchantNameInput.trim() || null,
        gstin: gstinInput.trim() || null,
      });

      setSettings((prev) => ({
        ...prev,
        upi_id: upiIdInput.trim() || null,
        upi_qr_url: upiQrPreview || null,
        upi_merchant_name: upiMerchantNameInput.trim() || null,
        gstin: gstinInput.trim() || null,
      }));

      setSuccessMsg('Restaurant UPI QR & Payment Details saved successfully. Future bills will use this configuration.');
    } catch (err) {
      setError(toFailure(err, 'Failed to save payment settings.').message);
    } finally {
      setSaving(false);
    }
  };

  const handleCancelPayments = () => {
    setUpiIdInput(settings.upi_id || settings.upiId || '');
    setUpiQrPreview(settings.upi_qr_url || settings.upiQrUrl || null);
    setUpiMerchantNameInput(settings.upi_merchant_name || settings.upiMerchantName || '');
    setGstinInput(settings.gstin || '');
    setQrFileError('');
    setError('');
  };

  return (
    <ConsoleLayout title="RMS Settings" roleLabel="Restaurant" nav={RESTAURANT_NAV}>
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

      <div className="nabin-stack" style={{ gap: 20 }}>
        {/* Navigation Tabs */}
        <header className="nabin-card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 900, color: '#1A3BA2' }}>Restaurant Configuration</h1>
            <p className="nabin-cell-meta">
              Manage ordering channels, tax rules, staff roles, and restaurant-owned UPI QR codes.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={() => setActiveTab('channels')}
              className={`nabin-btn ${activeTab === 'channels' ? 'nabin-btn--primary' : 'nabin-btn--ghost'}`}
              style={{ padding: '8px 16px', fontSize: 14 }}
            >
              Channels & Tax Rules
            </button>
            <button
              onClick={() => setActiveTab('payments')}
              className={`nabin-btn ${activeTab === 'payments' ? 'nabin-btn--primary' : 'nabin-btn--ghost'}`}
              style={{ padding: '8px 16px', fontSize: 14 }}
            >
              Payments: UPI QR & Details
            </button>
            <button onClick={() => void loadSettings()} className="nabin-btn nabin-btn--ghost" aria-label="Refresh">
              <RefreshIcon />
            </button>
          </div>
        </header>

        {activeTab === 'channels' ? (
          <form onSubmit={handleSaveChannels} className="nabin-stack" style={{ gap: 20 }}>
            {/* Channel Controls */}
            <section className="nabin-card">
              <h2 style={{ fontSize: 18, fontWeight: 800, marginBottom: 12 }}>Order Channel Availability</h2>
              <div className="nabin-stack" style={{ gap: 16 }}>
                <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', padding: '12px 0', borderBottom: '1px solid var(--border)' }}>
                  <div>
                    <strong style={{ fontSize: 15, display: 'block' }}>🍽️ Enable Dine-In Channel</strong>
                    <span className="nabin-cell-meta">Allows QR code table ordering, floor seating, and staff-assisted dining sessions.</span>
                  </div>
                  <input
                    type="checkbox"
                    checked={settings.dine_in_enabled}
                    onChange={(e) => setSettings({ ...settings, dine_in_enabled: e.target.checked })}
                    style={{ width: 22, height: 22, accentColor: '#1A3BA2' }}
                  />
                </label>

                <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', padding: '12px 0', borderBottom: '1px solid var(--border)' }}>
                  <div>
                    <strong style={{ fontSize: 15, display: 'block' }}>🛍️ Enable Takeaway Channel</strong>
                    <span className="nabin-cell-meta">Allows customer self-pickups and counter walk-in orders with staff handover.</span>
                  </div>
                  <input
                    type="checkbox"
                    checked={settings.takeaway_enabled}
                    onChange={(e) => setSettings({ ...settings, takeaway_enabled: e.target.checked })}
                    style={{ width: 22, height: 22, accentColor: '#1A3BA2' }}
                  />
                </label>

                <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', padding: '12px 0' }}>
                  <div>
                    <strong style={{ fontSize: 15, display: 'block' }}>🛵 Enable Food Delivery Channel</strong>
                    <span className="nabin-cell-meta">Integrates with the NABIN driver fleet and broadcasts requests on food ready.</span>
                  </div>
                  <input
                    type="checkbox"
                    checked={settings.delivery_enabled}
                    onChange={(e) => setSettings({ ...settings, delivery_enabled: e.target.checked })}
                    style={{ width: 22, height: 22, accentColor: '#1A3BA2' }}
                  />
                </label>
              </div>
            </section>

            {/* Pricing, Tax & Service Charge Rules */}
            <section className="nabin-card">
              <h2 style={{ fontSize: 18, fontWeight: 800, marginBottom: 12 }}>Taxes & Surcharge Rules</h2>
              <div className="nabin-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
                <div>
                  <label style={{ fontSize: 13, fontWeight: 700, display: 'block', marginBottom: 6 }}>
                    GST Tax Rate (%)
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    max="28"
                    value={settings.tax_rate_percent}
                    onChange={(e) => setSettings({ ...settings, tax_rate_percent: Number(e.target.value) })}
                    style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)' }}
                  />
                  <span className="nabin-cell-meta" style={{ marginTop: 4, display: 'block' }}>Standard GST rate (typically 5% for restaurants).</span>
                </div>

                <div>
                  <label style={{ fontSize: 13, fontWeight: 700, display: 'block', marginBottom: 6 }}>
                    Service Charge Rate (%)
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    max="20"
                    value={settings.service_charge_percent}
                    onChange={(e) => setSettings({ ...settings, service_charge_percent: Number(e.target.value) })}
                    style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)' }}
                  />
                  <span className="nabin-cell-meta" style={{ marginTop: 4, display: 'block' }}>Optional dine-in service charge percentage.</span>
                </div>

                <div>
                  <label style={{ fontSize: 13, fontWeight: 700, display: 'block', marginBottom: 6 }}>
                    Packaging Fee (₹)
                  </label>
                  <input
                    type="number"
                    step="1"
                    min="0"
                    max="100"
                    value={settings.packaging_fee}
                    onChange={(e) => setSettings({ ...settings, packaging_fee: Number(e.target.value) })}
                    style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)' }}
                  />
                  <span className="nabin-cell-meta" style={{ marginTop: 4, display: 'block' }}>Applies to Takeaway & Delivery orders for packaging.</span>
                </div>

                <div>
                  <label style={{ fontSize: 13, fontWeight: 700, display: 'block', marginBottom: 6 }}>
                    Default Prep Time (Minutes)
                  </label>
                  <input
                    type="number"
                    step="1"
                    min="5"
                    max="120"
                    value={settings.prep_time_minutes}
                    onChange={(e) => setSettings({ ...settings, prep_time_minutes: Number(e.target.value) })}
                    style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)' }}
                  />
                  <span className="nabin-cell-meta" style={{ marginTop: 4, display: 'block' }}>Baseline kitchen preparation estimate.</span>
                </div>
              </div>
            </section>

            <div className="nabin-row" style={{ justifyContent: 'flex-end' }}>
              <button
                type="submit"
                disabled={saving}
                className="nabin-btn nabin-btn--primary"
                style={{ minHeight: 44, padding: '0 24px', backgroundColor: '#1A3BA2' }}
              >
                {saving ? 'Saving...' : 'Save Channel & Tax Settings'}
              </button>
            </div>
          </form>
        ) : (
          /* DEDICATED PAYMENTS TAB: UPI QR & PAYMENT DETAILS */
          <div className="nabin-grid" style={{ gridTemplateColumns: 'minmax(320px, 1.2fr) minmax(280px, 0.8fr)', gap: 24 }}>
            {/* Left Column: Form & Management */}
            <form onSubmit={handleSavePayments} className="nabin-stack" style={{ gap: 20 }}>
              <section className="nabin-card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <h2 style={{ fontSize: 18, fontWeight: 800 }}>Restaurant-Owned UPI Details</h2>
                  <span className="nabin-badge nabin-badge--info" style={{ fontSize: 11 }}>Tenant-Isolated</span>
                </div>
                <p className="nabin-cell-meta" style={{ marginBottom: 16 }}>
                  Direct payments: Your customers pay directly into your account. NABIN records sales without deducting gateway processing fees.
                </p>

                <div className="nabin-stack" style={{ gap: 16 }}>
                  {/* UPI ID */}
                  <div>
                    <label style={{ fontSize: 13, fontWeight: 700, display: 'block', marginBottom: 6 }}>
                      Restaurant UPI ID (VPA)
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. deliciousdiner@okhdfcbank"
                      value={upiIdInput}
                      onChange={(e) => setUpiIdInput(e.target.value)}
                      style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 14 }}
                    />
                    <span className="nabin-cell-meta" style={{ marginTop: 4, display: 'block' }}>
                      Format: username@bank. Customers can type this UPI ID or use your uploaded static QR.
                    </span>
                  </div>

                  {/* Payee Name */}
                  <div>
                    <label style={{ fontSize: 13, fontWeight: 700, display: 'block', marginBottom: 6 }}>
                      UPI Payee / Business Name
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Delicious Diner Restaurant"
                      value={upiMerchantNameInput}
                      onChange={(e) => setUpiMerchantNameInput(e.target.value)}
                      style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 14 }}
                    />
                    <span className="nabin-cell-meta" style={{ marginTop: 4, display: 'block' }}>
                      Name displayed to customer when verifying in their UPI banking app.
                    </span>
                  </div>

                  {/* GSTIN */}
                  <div>
                    <label style={{ fontSize: 13, fontWeight: 700, display: 'block', marginBottom: 6 }}>
                      GSTIN (Goods and Services Tax Identification Number)
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. 29ABCDE1234F1Z5"
                      value={gstinInput}
                      onChange={(e) => setGstinInput(e.target.value)}
                      style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 14 }}
                    />
                    <span className="nabin-cell-meta" style={{ marginTop: 4, display: 'block' }}>
                      Printed on customer tax invoices and bills.
                    </span>
                  </div>
                </div>
              </section>

              {/* Static UPI QR Image Management */}
              <section className="nabin-card">
                <h2 style={{ fontSize: 18, fontWeight: 800, marginBottom: 8 }}>Static UPI QR Code Image</h2>
                <p className="nabin-cell-meta" style={{ marginBottom: 16 }}>
                  Upload your genuine bank/UPI QR sticker. We will display your exact QR on final dining bills with instructions for the guest to scan and enter their bill amount.
                </p>

                {qrFileError && (
                  <div className="nabin-alert nabin-alert--danger" style={{ marginBottom: 12 }}>
                    <span>{qrFileError}</span>
                  </div>
                )}

                {upiQrPreview ? (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, padding: 16, backgroundColor: '#f8fafc', borderRadius: 12, border: '1px solid var(--border)' }}>
                    <div style={{ width: 180, height: 180, backgroundColor: '#fff', borderRadius: 8, padding: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid #e2e8f0' }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={upiQrPreview} alt="Restaurant Static UPI QR" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
                    </div>
                    <span style={{ fontSize: 12, color: '#16a34a', fontWeight: 600 }}>✅ Static UPI QR Image Loaded</span>
                    <div style={{ display: 'flex', gap: 10 }}>
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="nabin-btn nabin-btn--ghost"
                        style={{ fontSize: 13 }}
                      >
                        Replace Image
                      </button>
                      <button
                        type="button"
                        onClick={handleRemoveQr}
                        className="nabin-btn nabin-btn--danger"
                        style={{ fontSize: 13 }}
                      >
                        Remove QR
                      </button>
                    </div>
                  </div>
                ) : (
                  <div
                    onClick={() => fileInputRef.current?.click()}
                    style={{
                      border: '2px dashed #cbd5e1',
                      borderRadius: 12,
                      padding: '32px 20px',
                      textAlign: 'center',
                      cursor: 'pointer',
                      backgroundColor: '#f8fafc',
                      transition: 'border-color 0.2s',
                    }}
                  >
                    <div style={{ fontSize: 32, marginBottom: 8 }}>📷</div>
                    <strong style={{ display: 'block', fontSize: 15, marginBottom: 4 }}>Click to upload genuine static UPI QR</strong>
                    <span className="nabin-cell-meta">Supports PNG, JPEG, and WebP (Max 5MB).</span>
                  </div>
                )}

                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleQrFileChange}
                  accept="image/png,image/jpeg,image/webp"
                  style={{ display: 'none' }}
                />

                <div style={{ marginTop: 14, padding: 10, borderRadius: 8, backgroundColor: '#eff6ff', border: '1px solid #bfdbfe' }}>
                  <span style={{ fontSize: 12, color: '#1e40af', lineHeight: 1.4, display: 'block' }}>
                    🔒 <strong>Security & Compliance:</strong> Only authorized Owners and Managers can modify payment settings. NABIN does not route restaurant direct funds through any payment gateway.
                  </span>
                </div>
              </section>

              {/* Action Buttons */}
              <div className="nabin-row" style={{ justifyContent: 'flex-end', gap: 12 }}>
                <button
                  type="button"
                  onClick={handleCancelPayments}
                  disabled={saving}
                  className="nabin-btn nabin-btn--ghost"
                  style={{ minHeight: 44, padding: '0 20px' }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="nabin-btn nabin-btn--primary"
                  style={{ minHeight: 44, padding: '0 24px', backgroundColor: '#1A3BA2' }}
                >
                  {saving ? 'Saving...' : 'Save UPI & Payment Details'}
                </button>
              </div>
            </form>

            {/* Right Column: Live Bill / Receipt Preview */}
            <aside className="nabin-card" style={{ backgroundColor: '#fafafa', border: '1px solid #e2e8f0', height: 'fit-content' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, borderBottom: '1px solid #e2e8f0', paddingBottom: 8 }}>
                <h3 style={{ fontSize: 15, fontWeight: 800 }}>Customer Bill Preview</h3>
                <span style={{ fontSize: 11, backgroundColor: '#1A3BA2', color: '#fff', padding: '2px 8px', borderRadius: 4, fontWeight: 700 }}>
                  LIVE PREVIEW
                </span>
              </div>
              <p className="nabin-cell-meta" style={{ marginBottom: 14 }}>
                This is how payment instructions and your static QR appear on customer dining receipts:
              </p>

              {/* Mock Receipt Sheet */}
              <div style={{ backgroundColor: '#fff', padding: 20, borderRadius: 8, boxShadow: '0 2px 8px rgba(0,0,0,0.06)', fontFamily: 'monospace' }}>
                <div style={{ textAlign: 'center', borderBottom: '1px dashed #cbd5e1', paddingBottom: 12, marginBottom: 12 }}>
                  <h4 style={{ margin: 0, fontSize: 16, fontWeight: 900, color: '#1A3BA2' }}>
                    {merchant?.name || 'NABIN RESTAURANT'}
                  </h4>
                  <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>
                    Station Road, City Center
                  </div>
                  {gstinInput.trim() && (
                    <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
                      GSTIN: {gstinInput.trim()}
                    </div>
                  )}
                  <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>
                    INV-2026-0042 • Table T-101
                  </div>
                </div>

                {/* Items */}
                <div style={{ fontSize: 12, borderBottom: '1px dashed #cbd5e1', paddingBottom: 10, marginBottom: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span>1x Special Biryani</span>
                    <span>₹320.00</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span>2x Butter Naan</span>
                    <span>₹120.00</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', color: '#64748b' }}>
                    <span>GST (5%)</span>
                    <span>₹22.00</span>
                  </div>
                </div>

                {/* Total */}
                <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 900, fontSize: 14, marginBottom: 14 }}>
                  <span>TOTAL AMOUNT</span>
                  <span>₹462.00</span>
                </div>

                {/* UPI QR & Payment instructions area */}
                {upiQrPreview ? (
                  <div style={{ border: '1px solid #1A3BA2', borderRadius: 8, padding: 12, textAlign: 'center', backgroundColor: '#f0f4ff' }}>
                    <div style={{ width: 120, height: 120, margin: '0 auto 8px', backgroundColor: '#fff', padding: 6, borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={upiQrPreview} alt="Receipt QR" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
                    </div>
                    <strong style={{ fontSize: 12, color: '#1A3BA2', display: 'block', marginBottom: 2 }}>
                      Scan with your UPI app and enter the bill amount.
                    </strong>
                    {upiIdInput.trim() && (
                      <span style={{ fontSize: 11, color: '#475569', display: 'block' }}>
                        UPI ID: <strong>{upiIdInput.trim()}</strong>
                      </span>
                    )}
                  </div>
                ) : upiIdInput.trim() ? (
                  <div style={{ border: '1px solid #cbd5e1', borderRadius: 8, padding: 10, textAlign: 'center', backgroundColor: '#f8fafc' }}>
                    <strong style={{ fontSize: 12, color: '#334155', display: 'block' }}>Pay via UPI:</strong>
                    <span style={{ fontSize: 13, fontWeight: 800, color: '#1A3BA2' }}>{upiIdInput.trim()}</span>
                  </div>
                ) : (
                  <div style={{ padding: 10, textAlign: 'center', backgroundColor: '#f8fafc', borderRadius: 6, border: '1px dashed #cbd5e1' }}>
                    <span style={{ fontSize: 11, color: '#94a3b8' }}>
                      No static QR configured. Bill will instruct cash/card counter checkout without QR code.
                    </span>
                  </div>
                )}

                <div style={{ textAlign: 'center', marginTop: 12, fontSize: 10, color: '#94a3b8' }}>
                  Thank you for dining with us!
                </div>
              </div>
            </aside>
          </div>
        )}
      </div>
    </ConsoleLayout>
  );
}
