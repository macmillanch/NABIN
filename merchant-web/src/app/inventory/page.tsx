'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import ConsoleLayout from '@/components/ConsoleLayout';
import {
  BoxesIcon,
  RefreshIcon,
  SearchIcon,
  ShoppingBagIcon,
} from '@/components/Icons';
import ProductFormModal from '@/components/ProductFormModal';
import ProductPreviewModal from '@/components/ProductPreviewModal';
import { useMerchant } from '@/context/MerchantAuth';
import {
  type GroceryProductItem,
  getStoredGroceryProducts,
  saveStoredGroceryProducts,
  exportDemoCatalogPayload,
} from '@/lib/catalogData';
import { inr } from '@/lib/format';

export default function InventoryPage() {
  const { merchant, loading, hasGrocery } = useMerchant();
  const router = useRouter();

  // Products state
  const [products, setProducts] = useState<GroceryProductItem[]>([]);
  const [query, setQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('ALL');
  const [stockFilter, setStockFilter] = useState<'ALL' | 'IN_STOCK' | 'LOW_STOCK' | 'OUT_OF_STOCK'>('ALL');
  const [pending, setPending] = useState(true);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  // Modals state
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingProduct, setEditingProduct] = useState<GroceryProductItem | null>(null);
  const [previewProduct, setPreviewProduct] = useState<GroceryProductItem | null>(null);

  // Category management modal
  const [showCategoryManager, setShowCategoryManager] = useState(false);
  const [newCatInput, setNewCatInput] = useState('');

  const load = useCallback(() => {
    setPending(true);
    try {
      const stored = getStoredGroceryProducts();
      setProducts(stored);
      setError('');
    } catch {
      setError('Could not load grocery catalog.');
    } finally {
      setPending(false);
    }
  }, []);

  useEffect(() => {
    if (!loading && !merchant) router.replace('/login');
  }, [loading, merchant, router]);

  useEffect(() => {
    load();
  }, [load]);

  const categories = useMemo(() => {
    const cats = new Set<string>();
    products.forEach((p) => {
      if (p.category) cats.add(p.category);
    });
    return Array.from(cats).sort();
  }, [products]);

  const filterCategories = useMemo(() => {
    return ['ALL', ...categories];
  }, [categories]);

  const lowStockCount = useMemo(
    () => products.filter((p) => p.stockQty > 0 && p.stockQty <= p.lowStockThreshold).length,
    [products],
  );
  const outOfStockCount = useMemo(
    () => products.filter((p) => p.stockQty <= 0 || !p.isAvailable).length,
    [products],
  );

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return products.filter((p) => {
      if (selectedCategory !== 'ALL' && p.category !== selectedCategory) return false;
      if (stockFilter === 'IN_STOCK' && (p.stockQty <= 0 || !p.isAvailable)) return false;
      if (stockFilter === 'LOW_STOCK' && (p.stockQty <= 0 || p.stockQty > p.lowStockThreshold)) return false;
      if (stockFilter === 'OUT_OF_STOCK' && p.stockQty > 0 && p.isAvailable) return false;
      if (needle && !`${p.name} ${p.brand ?? ''} ${p.sku ?? ''} ${p.category}`.toLowerCase().includes(needle)) {
        return false;
      }
      return true;
    });
  }, [products, query, selectedCategory, stockFilter]);

  // Actions
  const adjustStock = (productId: string, delta: number) => {
    const updated = products.map((p) => {
      if (p.id !== productId) return p;
      const nextStock = Math.max(0, p.stockQty + delta);
      return {
        ...p,
        stockQty: nextStock,
        isAvailable: nextStock > 0 ? p.isAvailable : false,
        updatedAt: new Date().toISOString(),
      };
    });
    setProducts(updated);
    saveStoredGroceryProducts(updated);
  };

  const toggleAvailability = (productId: string) => {
    const updated = products.map((p) =>
      p.id === productId ? { ...p, isAvailable: !p.isAvailable, updatedAt: new Date().toISOString() } : p,
    );
    setProducts(updated);
    saveStoredGroceryProducts(updated);
    const target = updated.find((p) => p.id === productId);
    setNotice(`"${target?.name}" availability toggled to ${target?.isAvailable ? 'Active' : 'Hidden'}.`);
    setTimeout(() => setNotice(''), 3000);
  };

  const handleSaveProduct = (saved: GroceryProductItem) => {
    let updated: GroceryProductItem[];
    const exists = products.some((p) => p.id === saved.id);
    if (exists) {
      updated = products.map((p) => (p.id === saved.id ? saved : p));
      setNotice(`Product "${saved.name}" updated successfully.`);
    } else {
      updated = [saved, ...products];
      setNotice(`New product "${saved.name}" added to grocery store.`);
    }
    setProducts(updated);
    saveStoredGroceryProducts(updated);
    setShowAddModal(false);
    setEditingProduct(null);
    setTimeout(() => setNotice(''), 4000);
  };

  const handleDuplicateProduct = (prod: GroceryProductItem) => {
    const copy: GroceryProductItem = {
      ...prod,
      id: `prod-demo-${Date.now()}`,
      name: `${prod.name} (Copy)`,
      sku: `${prod.sku}-CPY`,
      updatedAt: new Date().toISOString(),
    };
    const updated = [copy, ...products];
    setProducts(updated);
    saveStoredGroceryProducts(updated);
    setNotice(`Duplicated "${prod.name}" as "${copy.name}".`);
    setTimeout(() => setNotice(''), 4000);
  };

  const handleDeleteProduct = (productId: string, prodName: string) => {
    if (!window.confirm(`Are you sure you want to delete "${prodName}" from inventory?`)) {
      return;
    }
    const updated = products.filter((p) => p.id !== productId);
    setProducts(updated);
    saveStoredGroceryProducts(updated);
    setNotice(`Product "${prodName}" removed from store.`);
    setTimeout(() => setNotice(''), 3500);
  };

  const handleAddCategory = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = newCatInput.trim();
    if (!clean) return;
    if (categories.includes(clean)) {
      setError('Category already exists.');
      return;
    }
    const placeholder: GroceryProductItem = {
      id: `prod-demo-${Date.now()}`,
      name: `Sample Product in ${clean}`,
      brand: 'NABIN Select',
      category: clean,
      sku: `CAT-${clean.substring(0, 3).toUpperCase()}-01`,
      description: `First product in category ${clean}`,
      unit: 'pack',
      sellingPrice: 100,
      mrp: 120,
      discountPercent: 16,
      stockQty: 20,
      lowStockThreshold: 5,
      isAvailable: true,
      photos: [],
      primaryPhotoIndex: 0,
      variants: [
        {
          id: `gvar-${Date.now()}`,
          name: 'Standard Pack',
          packSize: '1 pack',
          unit: 'pack',
          sellingPrice: 100,
          mrp: 120,
          sku: `CAT-${clean.substring(0, 3).toUpperCase()}-01`,
          stockQty: 20,
          isAvailable: true,
        },
      ],
      updatedAt: new Date().toISOString(),
    };
    const updated = [...products, placeholder];
    setProducts(updated);
    saveStoredGroceryProducts(updated);
    setNewCatInput('');
    setShowCategoryManager(false);
    setSelectedCategory(clean);
    setNotice(`Category "${clean}" created.`);
    setTimeout(() => setNotice(''), 3500);
  };

  const handleExport = () => {
    try {
      const json = exportDemoCatalogPayload();
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'nabin_demo_catalog.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setNotice('Exported demo catalog to JSON file (nabin_demo_catalog.json). Transfer this file to Customer Web to test.');
      setTimeout(() => setNotice(''), 4500);
    } catch (err: any) {
      setError(err?.message || 'Failed to export demo catalog.');
    }
  };

  if (loading || !merchant) {
    return <div className="nabin-skeleton" style={{ minHeight: '100vh', border: 'none' }} />;
  }

  if (!hasGrocery) {
    return (
      <ConsoleLayout title="Grocery Inventory">
        <div className="nabin-stack">
          <div
            className="nabin-card"
            style={{ textAlign: 'center', padding: 'var(--space-xxl) var(--space-md)' }}
          >
            <div style={{ fontSize: 48, marginBottom: 'var(--space-md)' }}>🛒</div>
            <h1 style={{ fontSize: 22, fontWeight: 800, marginBottom: 'var(--space-xs)' }}>
              Grocery Module Not Enabled
            </h1>
            <p style={{ color: 'var(--ink-muted)', maxWidth: 480, margin: '0 auto var(--space-lg)' }}>
              Your merchant account is currently registered as a <strong>Restaurant Partner</strong>. The grocery inventory module is only accessible to approved retail grocery partners.
            </p>
            <Link href="/menu" className="nabin-btn nabin-btn--primary">
              Go to Restaurant Menu &rarr;
            </Link>
          </div>
        </div>
      </ConsoleLayout>
    );
  }

  return (
    <ConsoleLayout title="Inventory & Stock">
      <div className="nabin-stack">
        {/* Top Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 16,
            flexWrap: 'wrap',
          }}
        >
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 800, margin: 0, color: 'var(--ink)' }}>
              Grocery Store Inventory & Catalog
            </h1>
            <p style={{ fontSize: 13, color: 'var(--ink-muted)', margin: '4px 0 0' }}>
              Manage retail SKUs, units of sale, pack variants, live stock balances, and customer pricing.
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={() => setShowCategoryManager(true)}
              className="nabin-btn nabin-btn--ghost"
              style={{ minHeight: 40, fontSize: 13 }}
            >
              🏷️ Organize Categories
            </button>

            <button
              type="button"
              onClick={load}
              className="nabin-btn nabin-btn--ghost"
              style={{ minHeight: 40, gap: 6, fontSize: 13 }}
            >
              <RefreshIcon size={16} />
              <span>Reload</span>
            </button>

            <button
              type="button"
              onClick={handleExport}
              className="nabin-btn nabin-btn--outline"
              style={{ minHeight: 40, fontSize: 13, borderColor: '#1A3BA2', color: '#1A3BA2', fontWeight: 700 }}
            >
              📥 Export Demo Catalog (JSON)
            </button>

            <button
              type="button"
              onClick={() => setShowAddModal(true)}
              className="nabin-btn nabin-btn--primary"
              style={{ minHeight: 40, padding: '0 20px', fontWeight: 800, fontSize: 14 }}
            >
              + Add New Product
            </button>
          </div>
        </div>

        {/* Demo Transfer notice banner */}
        <div
          style={{
            background: '#EFF6FF',
            border: '1px solid #BFDBFE',
            borderRadius: 8,
            padding: '12px 16px',
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
              <strong>Demo Catalog Transfer:</strong> Merchant Web (Port 3004) and Customer Web (Port 3000) have separate browser storage origins.
              Export grocery items as versioned JSON to import directly into Customer Web.
            </div>
          </div>
          <button
            type="button"
            onClick={handleExport}
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
            Export Demo Catalog (JSON)
          </button>
        </div>

        {/* Notices */}
        {notice && (
          <div className="nabin-alert nabin-alert--success" role="status" style={{ marginBottom: 0 }}>
            <span>✅ {notice}</span>
          </div>
        )}
        {error && (
          <div className="nabin-alert nabin-alert--danger" role="alert" style={{ marginBottom: 0 }}>
            <span>{error}</span>
          </div>
        )}

        {/* Demo banner indicator */}
        <div
          className="nabin-alert nabin-alert--info"
          style={{
            marginBottom: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 12,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span className="nabin-badge nabin-badge--primary" style={{ fontWeight: 800 }}>
              Live Demo Session
            </span>
            <span style={{ fontSize: 13 }}>
              Grocery items, pack sizes, stock quantities, and prices persist locally and synchronize with customer grocery ordering.
            </span>
          </div>
          <button
            type="button"
            onClick={() => {
              if (products.length > 0) setPreviewProduct(products[0]);
            }}
            className="nabin-btn nabin-btn--ghost"
            style={{ minHeight: 32, fontSize: 12, padding: '0 12px' }}
          >
            👀 Test Customer View
          </button>
        </div>

        {/* Inventory Metric Overview Banner */}
        <div
          className="nabin-card"
          style={{
            padding: '16px 20px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 'var(--space-md)',
            flexWrap: 'wrap',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
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
                <BoxesIcon size={18} />
              </div>
              <div>
                <div style={{ fontSize: 18, fontWeight: 800, lineHeight: 1 }}>{products.length}</div>
                <div style={{ fontSize: 11, color: 'var(--ink-muted)', fontWeight: 600 }}>Stocked SKUs</div>
              </div>
            </div>

            <div style={{ height: 28, width: 1, background: 'var(--divider)' }} />

            <div>
              <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--success-ink)', lineHeight: 1 }}>
                {products.filter((i) => i.stockQty > 0 && i.isAvailable).length}
              </div>
              <div style={{ fontSize: 11, color: 'var(--ink-muted)', fontWeight: 600 }}>In Stock</div>
            </div>

            <div style={{ height: 28, width: 1, background: 'var(--divider)' }} />

            <div>
              <div
                style={{
                  fontSize: 18,
                  fontWeight: 800,
                  color: lowStockCount > 0 ? 'var(--warning-dark)' : 'var(--ink-muted)',
                  lineHeight: 1,
                }}
              >
                {lowStockCount}
              </div>
              <div style={{ fontSize: 11, color: 'var(--ink-muted)', fontWeight: 600 }}>Low Stock Alert</div>
            </div>

            <div style={{ height: 28, width: 1, background: 'var(--divider)' }} />

            <div>
              <div
                style={{
                  fontSize: 18,
                  fontWeight: 800,
                  color: outOfStockCount > 0 ? 'var(--danger-dark)' : 'var(--ink-muted)',
                  lineHeight: 1,
                }}
              >
                {outOfStockCount}
              </div>
              <div style={{ fontSize: 11, color: 'var(--ink-muted)', fontWeight: 600 }}>Out of Stock</div>
            </div>
          </div>

          {/* Search Box & Stock Level Filter */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: '1 1 auto', maxWidth: 480, justifyContent: 'flex-end' }}>
            <div style={{ position: 'relative', width: '100%', maxWidth: 280 }}>
              <span
                style={{
                  position: 'absolute',
                  left: 12,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  color: 'var(--ink-muted)',
                  pointerEvents: 'none',
                }}
              >
                <SearchIcon size={16} />
              </span>
              <input
                className="nabin-input"
                type="search"
                placeholder="Search product, brand, SKU…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                style={{ paddingLeft: 36, minHeight: 40 }}
              />
            </div>

            <select
              className="nabin-select"
              value={stockFilter}
              onChange={(e) => setStockFilter(e.target.value as any)}
              style={{ width: 140, minHeight: 40, fontSize: 12 }}
            >
              <option value="ALL">All Stock</option>
              <option value="IN_STOCK">🟢 In Stock</option>
              <option value="LOW_STOCK">🟡 Low Stock</option>
              <option value="OUT_OF_STOCK">🔴 Out of Stock</option>
            </select>
          </div>
        </div>

        {/* Category Pill Bar */}
        {filterCategories.length > 1 && (
          <div className="nabin-filter-pill-bar" role="tablist" aria-label="Inventory categories">
            {filterCategories.map((cat) => {
              const active = selectedCategory === cat;
              const count = cat === 'ALL' ? products.length : products.filter((i) => i.category === cat).length;
              return (
                <button
                  key={cat}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  className={`nabin-filter-pill ${active ? 'nabin-filter-pill--active' : ''}`}
                  onClick={() => setSelectedCategory(cat)}
                >
                  <span>{cat === 'ALL' ? 'All Products' : cat}</span>
                  <span className="nabin-filter-pill__count">{count}</span>
                </button>
              );
            })}
          </div>
        )}

        {/* Product Inventory Table */}
        <section className="nabin-card">
          <header className="nabin-card__header">
            <div>
              <h2 style={{ fontSize: 18, fontWeight: 800, color: 'var(--ink)' }}>Active Store Inventory</h2>
              <p className="nabin-cell-meta">{filtered.length} products listed</p>
            </div>
          </header>

          {filtered.length === 0 ? (
            <div className="nabin-empty">
              <BoxesIcon size={32} />
              <p style={{ marginTop: 'var(--space-sm)', fontWeight: 700 }}>
                {pending ? 'Loading inventory…' : 'No items match your search or filter.'}
              </p>
              <button
                type="button"
                onClick={() => setShowAddModal(true)}
                className="nabin-btn nabin-btn--primary"
                style={{ marginTop: 12 }}
              >
                + Add Grocery Product
              </button>
            </div>
          ) : (
            <div className="nabin-table-wrap">
              <table className="nabin-table">
                <thead>
                  <tr>
                    <th style={{ width: 60 }}>Photo</th>
                    <th>Product & Brand</th>
                    <th>Category</th>
                    <th>Unit / Variants</th>
                    <th style={{ textAlign: 'right' }}>Price (₹)</th>
                    <th style={{ textAlign: 'center' }}>Stock & Adjustment</th>
                    <th>Status</th>
                    <th style={{ textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((item) => {
                    const isLow = item.stockQty > 0 && item.stockQty <= item.lowStockThreshold;
                    const isOut = item.stockQty <= 0 || !item.isAvailable;
                    const primaryPhoto = item.photos[item.primaryPhotoIndex] || item.photos[0] || '';

                    return (
                      <tr key={item.id}>
                        {/* Thumbnail */}
                        <td>
                          {primaryPhoto ? (
                            <div
                              style={{
                                width: 48,
                                height: 48,
                                borderRadius: 8,
                                overflow: 'hidden',
                                border: '1px solid #e2e8f0',
                                background: '#f8fafc',
                              }}
                            >
                              <img
                                src={primaryPhoto}
                                alt={item.name}
                                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                              />
                            </div>
                          ) : (
                            <div
                              style={{
                                width: 48,
                                height: 48,
                                borderRadius: 8,
                                background: '#f1f5f9',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: 20,
                              }}
                            >
                              📦
                            </div>
                          )}
                        </td>

                        {/* Product & Brand */}
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--brand)', textTransform: 'uppercase' }}>
                              {item.brand}
                            </span>
                          </div>
                          <div style={{ fontWeight: 800, color: 'var(--ink)', fontSize: 14 }}>
                            {item.name}
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--ink-muted)', marginTop: 2 }}>
                            SKU: {item.sku} {item.barcode ? `&bull; EAN: ${item.barcode}` : ''}
                          </div>
                        </td>

                        {/* Category */}
                        <td>
                          <span className="nabin-badge nabin-badge--neutral" style={{ fontSize: 11 }}>
                            {item.category}
                          </span>
                          {item.subcategory && (
                            <div style={{ fontSize: 11, color: 'var(--ink-muted)', marginTop: 2 }}>
                              {item.subcategory}
                            </div>
                          )}
                        </td>

                        {/* Unit / Variants */}
                        <td>
                          <div style={{ fontWeight: 700, fontSize: 12, color: 'var(--ink)' }}>
                            Sold by {item.unit}
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--ink-muted)' }}>
                            {item.variants.length} pack size{item.variants.length > 1 ? 's' : ''}
                          </div>
                        </td>

                        {/* Price */}
                        <td style={{ textAlign: 'right', fontWeight: 800 }}>
                          <div style={{ fontSize: 15 }}>{inr(item.sellingPrice)}</div>
                          {item.mrp && item.mrp > item.sellingPrice && (
                            <div style={{ fontSize: 11, color: 'var(--ink-muted)', textDecoration: 'line-through' }}>
                              {inr(item.mrp)}
                            </div>
                          )}
                        </td>

                        {/* Quick Stock Adjuster */}
                        <td style={{ textAlign: 'center' }}>
                          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: '#f8fafc', padding: '4px 8px', borderRadius: 8, border: '1px solid #e2e8f0' }}>
                            <button
                              type="button"
                              onClick={() => adjustStock(item.id, -1)}
                              disabled={item.stockQty <= 0}
                              style={{
                                width: 24,
                                height: 24,
                                borderRadius: 4,
                                border: '1px solid #cbd5e1',
                                background: '#ffffff',
                                cursor: item.stockQty <= 0 ? 'not-allowed' : 'pointer',
                                fontWeight: 800,
                              }}
                              title="Decrease Stock"
                            >
                              −
                            </button>
                            <span style={{ minWidth: 28, textAlign: 'center', fontWeight: 800, fontSize: 13 }}>
                              {item.stockQty}
                            </span>
                            <button
                              type="button"
                              onClick={() => adjustStock(item.id, 1)}
                              style={{
                                width: 24,
                                height: 24,
                                borderRadius: 4,
                                border: '1px solid #cbd5e1',
                                background: '#ffffff',
                                cursor: 'pointer',
                                fontWeight: 800,
                              }}
                              title="Increase Stock"
                            >
                              +
                            </button>
                          </div>
                        </td>

                        {/* Status */}
                        <td>
                          <span
                            className={`nabin-badge ${
                              isOut
                                ? 'nabin-badge--danger'
                                : isLow
                                  ? 'nabin-badge--warning'
                                  : 'nabin-badge--success'
                            }`}
                            style={{ fontSize: 11 }}
                          >
                            {isOut ? 'Out of Stock' : isLow ? `Low (${item.stockQty})` : 'In Stock'}
                          </span>
                        </td>

                        {/* Actions */}
                        <td style={{ textAlign: 'right' }}>
                          <div style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                            <button
                              type="button"
                              onClick={() => setPreviewProduct(item)}
                              className="nabin-btn nabin-btn--ghost"
                              style={{ minHeight: 32, padding: '0 8px', fontSize: 12 }}
                              title="Preview Customer View"
                            >
                              👀 Preview
                            </button>

                            <button
                              type="button"
                              onClick={() => setEditingProduct(item)}
                              className="nabin-btn nabin-btn--ghost"
                              style={{ minHeight: 32, padding: '0 8px', fontSize: 12 }}
                              title="Edit Product"
                            >
                              ✏️ Edit
                            </button>

                            <button
                              type="button"
                              onClick={() => handleDuplicateProduct(item)}
                              className="nabin-btn nabin-btn--ghost"
                              style={{ minHeight: 32, padding: '0 8px', fontSize: 12 }}
                              title="Duplicate Product"
                            >
                              📋
                            </button>

                            <button
                              type="button"
                              onClick={() => handleDeleteProduct(item.id, item.name)}
                              className="nabin-btn nabin-btn--ghost"
                              style={{
                                minHeight: 32,
                                padding: '0 8px',
                                fontSize: 12,
                                color: 'var(--danger)',
                                borderColor: 'var(--danger-tint)',
                              }}
                              title="Delete Product"
                            >
                              🗑️
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      {/* Add Product Modal */}
      {showAddModal && (
        <ProductFormModal
          categories={categories}
          onSave={handleSaveProduct}
          onClose={() => setShowAddModal(false)}
        />
      )}

      {/* Edit Product Modal */}
      {editingProduct && (
        <ProductFormModal
          initialProduct={editingProduct}
          categories={categories}
          onSave={handleSaveProduct}
          onClose={() => setEditingProduct(null)}
        />
      )}

      {/* Customer Preview Modal */}
      {previewProduct && (
        <ProductPreviewModal
          product={previewProduct}
          onClose={() => setPreviewProduct(null)}
        />
      )}

      {/* Organize Categories Modal */}
      {showCategoryManager && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 9999,
            background: 'rgba(15, 23, 42, 0.75)',
            backdropFilter: 'blur(6px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 'var(--space-md)',
          }}
        >
          <div
            style={{
              background: '#ffffff',
              borderRadius: 16,
              width: '100%',
              maxWidth: 480,
              padding: 24,
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h2 style={{ fontSize: 18, fontWeight: 800, margin: 0, color: 'var(--ink)' }}>
                Organize Grocery Categories
              </h2>
              <button
                type="button"
                onClick={() => setShowCategoryManager(false)}
                className="nabin-btn nabin-btn--ghost"
                style={{ minHeight: 32, padding: '0 10px' }}
              >
                ✕
              </button>
            </div>

            <div style={{ marginBottom: 16 }}>
              <strong style={{ fontSize: 13, color: 'var(--ink)' }}>Existing Categories:</strong>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                {categories.map((c) => (
                  <span key={c} className="nabin-badge nabin-badge--neutral" style={{ fontSize: 12, padding: '4px 10px' }}>
                    {c}
                  </span>
                ))}
              </div>
            </div>

            <form onSubmit={handleAddCategory} style={{ display: 'flex', gap: 8 }}>
              <input
                className="nabin-input"
                placeholder="New Category Name (e.g. Organic, Bakery)…"
                value={newCatInput}
                onChange={(e) => setNewCatInput(e.target.value)}
                required
              />
              <button type="submit" className="nabin-btn nabin-btn--primary" style={{ minWidth: 100 }}>
                + Add
              </button>
            </form>
          </div>
        </div>
      )}
    </ConsoleLayout>
  );
}
