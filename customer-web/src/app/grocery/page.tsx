'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import AppShell from '@/components/AppShell';
import CustomerGroceryCustomizer, { type CustomizedGroceryCartItem } from '@/components/CustomerGroceryCustomizer';
import FlowPage from '@/components/FlowPage';
import useSession from '@/hooks/useSession';
import { bookingApi } from '@/lib/api';
import {
  type GroceryProductItem,
  getStoredGroceryProducts,
  importDemoCatalogPayload,
} from '@/lib/catalogData';
import { inr, toFailure } from '@/lib/format';

interface GroceryOrder {
  id: string;
  order_number?: string;
  status?: string;
  checkoutId?: string;
  finalTotal?: number;
  deliveryAddress?: string;
  items?: { productName?: string; quantity?: number; unit?: string; finalItemAmount?: number }[];
}

// Cash only: the grocery checkout writes an order and a delivery job and moves no money, so a wallet
// option here would record a payment method nothing ever charges. The rider collects it at handover.
const PAYMENT = [
  { value: 'CASH', label: 'Cash on delivery', meta: 'Pay the delivery partner' },
] as const;

export default function GroceryPage() {
  const { user, loading } = useSession();

  // Products & filtering
  const [products, setProducts] = useState<GroceryProductItem[]>([]);
  const [selectedCategory, setSelectedCategory] = useState('ALL');
  const [search, setSearch] = useState('');
  const [customizingProduct, setCustomizingProduct] = useState<GroceryProductItem | null>(null);

  // Cart & checkout
  const [cart, setCart] = useState<CustomizedGroceryCartItem[]>([]);
  const [storeId, setStoreId] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<string>('CASH');
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [instructions, setInstructions] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState('');
  const [order, setOrder] = useState<GroceryOrder | null>(null);

  // --- demo catalog transfer ---
  const [importNotice, setImportNotice] = useState('');
  const [importError, setImportError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleCatalogImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const text = ev.target?.result as string;
        const res = importDemoCatalogPayload(text);
        if (res.success) {
          setImportNotice(`Imported demo catalog: ${res.productCount} grocery products, ${res.dishCount} restaurant dishes.`);
          setImportError('');
          loadProducts();
        } else {
          setImportError(res.error || 'Failed to import demo catalog.');
          setImportNotice('');
        }
      } catch (err: any) {
        setImportError(err?.message || 'Invalid JSON catalog file.');
        setImportNotice('');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const loadProducts = useCallback(() => {
    try {
      const stored = getStoredGroceryProducts();
      setProducts(stored);
    } catch {
      setProducts([]);
    }
  }, []);

  useEffect(() => {
    loadProducts();
  }, [loadProducts]);

  const categories = useMemo(() => {
    const cats = new Set<string>();
    products.forEach((p) => {
      if (p.category) cats.add(p.category);
    });
    return ['ALL', ...Array.from(cats).sort()];
  }, [products]);

  const filteredProducts = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return products.filter((p) => {
      if (selectedCategory !== 'ALL' && p.category !== selectedCategory) return false;
      if (needle && !`${p.name} ${p.brand} ${p.category} ${p.sku}`.toLowerCase().includes(needle)) {
        return false;
      }
      return true;
    });
  }, [products, search, selectedCategory]);

  const cartCount = cart.reduce((n, l) => n + l.quantity, 0);
  const cartSubtotal = cart.reduce((n, l) => n + l.unitPrice * l.quantity, 0);

  const handleAddToCart = (item: CustomizedGroceryCartItem) => {
    setCart((prev) => {
      const existing = prev.find(
        (l) => l.productId === item.productId && l.packSize === item.packSize,
      );
      if (existing) {
        return prev.map((l) =>
          l.productId === item.productId && l.packSize === item.packSize
            ? { ...l, quantity: l.quantity + item.quantity }
            : l,
        );
      }
      return [...prev, item];
    });
  };

  const removeCartLine = (idx: number) => {
    setCart((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (cart.length === 0) {
      setFailure('Add at least one grocery item to your basket.');
      return;
    }
    if (!deliveryAddress.trim()) {
      setFailure('Enter your delivery address.');
      return;
    }
    if (!storeId.trim()) {
      setFailure('Enter the partner store you are ordering from.');
      return;
    }

    setBusy(true);
    setFailure('');
    setOrder(null);

    try {
      const res = await bookingApi.checkoutGrocery({
        merchantId: storeId.trim(),
        paymentMethod,
        deliveryAddress: deliveryAddress.trim(),
        deliveryInstructions: instructions.trim() || undefined,
        items: cart.map((line) => ({ name: `${line.brand} ${line.name}`, quantity: line.quantity })),
      });
      if (res.data.success) {
        setOrder(res.data.order);
        setCart([]);
        setInstructions('');
      } else {
        setFailure(res.data.error || 'Checkout failed.');
      }
    } catch (err) {
      setFailure(toFailure(err, 'Could not complete grocery order.').message);
    } finally {
      setBusy(false);
    }
  };

  if (loading || !user) {
    return (
      <AppShell>
        <div className="nabin-skeleton" style={{ height: 260, borderRadius: 20 }} />
      </AppShell>
    );
  }

  return (
    <AppShell>
      <FlowPage
        title="Grocery Store"
        subtitle="Fresh staples, edible oils, dairy, spices, and essentials from local NABIN partners."
      >
        {/* Demo Catalog Transfer Banner */}
        <div
          style={{
            background: '#EFF6FF',
            border: '1px solid #BFDBFE',
            borderRadius: 8,
            padding: '12px 16px',
            marginBottom: 'var(--space-md)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            flexWrap: 'wrap',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 18 }}>🔄</span>
            <div style={{ fontSize: 13, color: '#1E3A8A' }}>
              <strong>Demo Catalog Transfer:</strong> Load grocery products and pack sizes exported from Merchant Web (JSON).
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              type="file"
              accept=".json"
              ref={fileInputRef}
              onChange={handleCatalogImport}
              style={{ display: 'none' }}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="nabin-btn"
              style={{
                background: '#1A3BA2',
                color: '#FFFFFF',
                fontSize: 12,
                padding: '6px 14px',
                fontWeight: 700,
                borderRadius: 8,
              }}
            >
              📥 Import Demo Catalog (JSON)
            </button>
          </div>
        </div>

        {importNotice && (
          <div className="nabin-alert nabin-alert--success" role="status" style={{ marginBottom: 'var(--space-md)' }}>
            <span>✅ {importNotice}</span>
          </div>
        )}
        {importError && (
          <div className="nabin-alert nabin-alert--danger" role="alert" style={{ marginBottom: 'var(--space-md)' }}>
            <span>⚠️ {importError}</span>
          </div>
        )}

        {/* Banner */}
        <div
          className="nabin-alert nabin-alert--info"
          style={{
            marginBottom: 'var(--space-md)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 10,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="nabin-badge nabin-badge--primary">Saved Catalog</span>
            <span style={{ fontSize: 13 }}>
              Products and pack variants come from the catalog saved in this browser. Ordering still
              posts to the partner store id you enter below.
            </span>
          </div>
          <button
            type="button"
            onClick={loadProducts}
            className="nabin-btn nabin-btn--ghost"
            style={{ minHeight: 32, fontSize: 12, padding: '0 10px' }}
          >
            ↻ Reload Saved Products
          </button>
        </div>

        {/* Order placed, as written by the checkout route */}
        {order && (
          <div className="nabin-alert nabin-alert--success" role="status" style={{ marginBottom: 'var(--space-lg)' }}>
            <h2>Grocery order placed</h2>
            <div className="nabin-list-row">
              <span className="nabin-cell-meta">Order Number</span>
              <span className="nabin-mono">{order.order_number || order.id}</span>
            </div>
            {(order.items ?? []).map((item, index) => (
              <div key={index} className="nabin-list-row">
                <span style={{ fontWeight: 700 }}>
                  {item.quantity}× {item.productName}
                </span>
                <span className="nabin-num">{inr(item.finalItemAmount)}</span>
              </div>
            ))}
            <div className="nabin-list-row">
              <span className="nabin-cell-meta">Total Amount</span>
              <span className="nabin-order__amount nabin-num">{inr(order.finalTotal)}</span>
            </div>
            <div className="nabin-list-row" style={{ borderBottom: 'none' }}>
              <span className="nabin-cell-meta">
                {PAYMENT.find((p) => p.value === paymentMethod)?.label ?? paymentMethod}
                {order.deliveryAddress ? ` &bull; ${order.deliveryAddress}` : ''}
              </span>
              {order.status && (
                <span className="nabin-badge nabin-badge--success">{order.status}</span>
              )}
            </div>
            <p style={{ marginTop: 'var(--space-sm)', fontSize: 13 }}>
              <Link href="/orders" className="nabin-alert__action" style={{ margin: 0 }}>
                Track it in My orders &rarr;
              </Link>
            </p>
          </div>
        )}

        {failure && (
          <div className="nabin-alert nabin-alert--danger" role="alert" style={{ marginBottom: 'var(--space-md)' }}>
            <span>{failure}</span>
          </div>
        )}

        {/* Search & Category Pills */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 'var(--space-lg)' }}>
          <div style={{ position: 'relative', width: '100%' }}>
            <input
              className="nabin-input"
              type="search"
              placeholder="Search grocery products, brands (Aashirvaad, Fortune, Tata, Amul)…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ minHeight: 44, fontSize: 14 }}
            />
          </div>

          {categories.length > 1 && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {categories.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={`nabin-btn ${selectedCategory === c ? 'nabin-btn--primary' : 'nabin-btn--ghost'}`}
                  style={{ minHeight: 34, fontSize: 13, borderRadius: 20 }}
                  onClick={() => setSelectedCategory(c)}
                >
                  {c === 'ALL' ? 'All Products' : c}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Product Catalog Grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 16, marginBottom: 'var(--space-xl)' }}>
          {filteredProducts.map((p) => {
            const primaryPhoto = p.photos[p.primaryPhotoIndex] || p.photos[0] || '';
            const isOut = p.stockQty <= 0 || !p.isAvailable;
            const isLow = p.stockQty > 0 && p.stockQty <= p.lowStockThreshold;

            return (
              <div
                key={p.id}
                className="nabin-card"
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  padding: 14,
                  borderRadius: 14,
                  border: '1px solid #e2e8f0',
                  transition: 'all 0.2s ease',
                  background: '#ffffff',
                }}
              >
                {/* Photo Thumbnail */}
                <div
                  style={{
                    width: '100%',
                    height: 140,
                    borderRadius: 10,
                    overflow: 'hidden',
                    background: '#f8fafc',
                    position: 'relative',
                    marginBottom: 10,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {primaryPhoto ? (
                    <img
                      src={primaryPhoto}
                      alt={p.name}
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    />
                  ) : (
                    <span style={{ fontSize: 44 }}>📦</span>
                  )}
                  {p.discountPercent && p.discountPercent > 0 && (
                    <span
                      className="nabin-badge nabin-badge--success"
                      style={{ position: 'absolute', top: 8, left: 8, fontSize: 10, fontWeight: 800 }}
                    >
                      {p.discountPercent}% OFF
                    </span>
                  )}
                  {isOut ? (
                    <span
                      className="nabin-badge nabin-badge--danger"
                      style={{ position: 'absolute', top: 8, right: 8, fontSize: 10, fontWeight: 800 }}
                    >
                      Sold Out
                    </span>
                  ) : isLow ? (
                    <span
                      className="nabin-badge nabin-badge--warning"
                      style={{ position: 'absolute', top: 8, right: 8, fontSize: 10, fontWeight: 800 }}
                    >
                      Low Stock
                    </span>
                  ) : null}
                </div>

                {/* Details */}
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--brand)', textTransform: 'uppercase' }}>
                    {p.brand}
                  </span>
                  <h3 style={{ fontSize: 15, fontWeight: 800, margin: '2px 0 4px', color: 'var(--ink)' }}>
                    {p.name}
                  </h3>
                  <p style={{ fontSize: 12, color: 'var(--ink-muted)', margin: '0 0 10px', flex: 1, lineHeight: 1.4 }}>
                    {p.description}
                  </p>

                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 12 }}>
                    <span style={{ fontSize: 18, fontWeight: 800, color: 'var(--ink)' }}>
                      {inr(p.sellingPrice)}
                    </span>
                    <span style={{ fontSize: 12, color: 'var(--ink-muted)' }}>/ {p.unit}</span>
                    {p.mrp && p.mrp > p.sellingPrice && (
                      <s style={{ fontSize: 12, color: 'var(--ink-muted)' }}>{inr(p.mrp)}</s>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() => setCustomizingProduct(p)}
                    disabled={isOut}
                    className="nabin-btn nabin-btn--primary"
                    style={{
                      minHeight: 36,
                      fontSize: 13,
                      fontWeight: 700,
                      width: '100%',
                      opacity: isOut ? 0.5 : 1,
                    }}
                  >
                    {isOut ? 'Sold Out' : p.variants.length > 1 ? '+ Select Pack Size' : '+ Add to Basket'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Shopping Basket & Checkout Form */}
        {cartCount > 0 && (
          <form onSubmit={handleSubmit} className="nabin-form nabin-card" style={{ marginTop: 'var(--space-md)' }}>
            <h2>Your Grocery Basket ({cartCount} item{cartCount > 1 ? 's' : ''})</h2>

            {cart.map((line, idx) => (
              <div key={idx} className="nabin-list-row" style={{ alignItems: 'center' }}>
                <div>
                  <span style={{ fontWeight: 700 }}>
                    {line.quantity}× {line.brand} {line.name}
                  </span>
                  <div style={{ fontSize: 12, color: 'var(--brand)', fontWeight: 600 }}>
                    Pack / Size: {line.packSize}
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span className="nabin-num" style={{ fontWeight: 800 }}>
                    {inr(line.unitPrice * line.quantity)}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeCartLine(idx)}
                    style={{
                      border: 'none',
                      background: 'transparent',
                      color: 'var(--danger)',
                      cursor: 'pointer',
                      fontSize: 14,
                      padding: '0 4px',
                    }}
                    title="Remove item"
                  >
                    ✕
                  </button>
                </div>
              </div>
            ))}

            <div className="nabin-list-row">
              <span className="nabin-cell-meta">Estimated Subtotal</span>
              <span className="nabin-order__amount nabin-num">{inr(cartSubtotal)}</span>
            </div>

            <div>
              <label className="nabin-label" htmlFor="store-id-input">
                Partner Store
              </label>
              <input
                id="store-id-input"
                className="nabin-input"
                type="text"
                value={storeId}
                onChange={(e) => setStoreId(e.target.value)}
                placeholder="e.g. mcht_1"
                required
              />
            </div>

            <div>
              <span className="nabin-label">Payment Method</span>
              <div className="nabin-segment">
                {PAYMENT.map((option) => (
                  <div key={option.value} className="nabin-segment__option">
                    <input
                      id={`pay-${option.value}`}
                      type="radio"
                      name="paymentMethod"
                      value={option.value}
                      checked={paymentMethod === option.value}
                      onChange={() => setPaymentMethod(option.value)}
                      disabled={busy}
                    />
                    <label className="nabin-segment__label" htmlFor={`pay-${option.value}`}>
                      <span className="nabin-segment__name">{option.label}</span>
                      <span className="nabin-segment__meta">{option.meta}</span>
                    </label>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <label className="nabin-label" htmlFor="address-input">
                Delivery Address
              </label>
              <input
                id="address-input"
                className="nabin-input"
                type="text"
                value={deliveryAddress}
                onChange={(e) => setDeliveryAddress(e.target.value)}
                placeholder="e.g. Flat 402, Civil Lines, Delhi"
                required
              />
            </div>

            <div>
              <label className="nabin-label" htmlFor="instructions-input">
                Delivery Instructions (optional)
              </label>
              <input
                id="instructions-input"
                className="nabin-input"
                type="text"
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                placeholder="e.g. Leave with building security"
              />
            </div>

            <button type="submit" className="nabin-btn nabin-btn--primary" disabled={busy} style={{ minHeight: 46 }}>
              {busy ? 'Placing Grocery Order…' : `Place Grocery Order (${inr(cartSubtotal)})`}
            </button>
          </form>
        )}

        {/* Product Customizer Modal */}
        {customizingProduct && (
          <CustomerGroceryCustomizer
            product={customizingProduct}
            onAddToCart={handleAddToCart}
            onClose={() => setCustomizingProduct(null)}
          />
        )}
      </FlowPage>
    </AppShell>
  );
}
