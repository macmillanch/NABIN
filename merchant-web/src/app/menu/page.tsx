'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import ConsoleLayout from '@/components/ConsoleLayout';
import DishFormModal from '@/components/DishFormModal';
import DishPreviewModal from '@/components/DishPreviewModal';
import { RefreshIcon, SearchIcon, UtensilsIcon } from '@/components/Icons';
import { useMerchant } from '@/context/MerchantAuth';
import {
  type RestaurantDishItem,
  getStoredMenuDishes,
  saveStoredMenuDishes,
  exportDemoCatalogPayload,
} from '@/lib/catalogData';
import { inr } from '@/lib/format';

export default function MenuPage() {
  const { merchant, loading, hasRestaurant } = useMerchant();
  const router = useRouter();

  // Dishes state
  const [dishes, setDishes] = useState<RestaurantDishItem[]>([]);
  const [query, setQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('ALL');
  const [availabilityFilter, setAvailabilityFilter] = useState<'ALL' | 'AVAILABLE' | 'SOLDOUT'>('ALL');
  const [pending, setPending] = useState(true);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  // Modals state
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingDish, setEditingDish] = useState<RestaurantDishItem | null>(null);
  const [previewDish, setPreviewDish] = useState<RestaurantDishItem | null>(null);

  // Category management modal
  const [showCategoryManager, setShowCategoryManager] = useState(false);
  const [newCatInput, setNewCatInput] = useState('');

  const load = useCallback(() => {
    setPending(true);
    try {
      const stored = getStoredMenuDishes();
      setDishes(stored);
      setError('');
    } catch {
      setError('Could not load menu catalog.');
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
    dishes.forEach((d) => {
      if (d.category) cats.add(d.category);
    });
    return Array.from(cats).sort();
  }, [dishes]);

  const filterCategories = useMemo(() => {
    return ['ALL', ...categories];
  }, [categories]);

  const inStockCount = useMemo(
    () => dishes.filter((d) => d.isAvailable).length,
    [dishes],
  );
  const soldOutCount = useMemo(
    () => dishes.filter((d) => !d.isAvailable).length,
    [dishes],
  );

  // Filtered & grouped items
  const filteredDishes = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return dishes.filter((d) => {
      if (selectedCategory !== 'ALL' && d.category !== selectedCategory) return false;
      if (availabilityFilter === 'AVAILABLE' && !d.isAvailable) return false;
      if (availabilityFilter === 'SOLDOUT' && d.isAvailable) return false;
      if (needle && !`${d.name} ${d.sku ?? ''} ${d.description}`.toLowerCase().includes(needle)) {
        return false;
      }
      return true;
    });
  }, [dishes, query, selectedCategory, availabilityFilter]);

  const grouped = useMemo(() => {
    const buckets = new Map<string, RestaurantDishItem[]>();
    for (const dish of filteredDishes) {
      const key = dish.category || 'Uncategorised';
      buckets.set(key, [...(buckets.get(key) ?? []), dish]);
    }
    return [...buckets.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [filteredDishes]);

  // Actions
  const toggleAvailability = (dishId: string) => {
    const updated = dishes.map((d) =>
      d.id === dishId ? { ...d, isAvailable: !d.isAvailable, updatedAt: new Date().toISOString() } : d,
    );
    setDishes(updated);
    saveStoredMenuDishes(updated);
    const target = updated.find((d) => d.id === dishId);
    setNotice(`"${target?.name}" is now marked as ${target?.isAvailable ? 'In Stock (Live)' : 'Sold Out'}.`);
    setTimeout(() => setNotice(''), 3500);
  };

  const handleSaveDish = (saved: RestaurantDishItem) => {
    let updated: RestaurantDishItem[];
    const exists = dishes.some((d) => d.id === saved.id);
    if (exists) {
      updated = dishes.map((d) => (d.id === saved.id ? saved : d));
      setNotice(`Dish "${saved.name}" updated successfully.`);
    } else {
      updated = [saved, ...dishes];
      setNotice(`New dish "${saved.name}" added to menu catalog.`);
    }
    setDishes(updated);
    saveStoredMenuDishes(updated);
    setShowAddModal(false);
    setEditingDish(null);
    setTimeout(() => setNotice(''), 4000);
  };

  const handleDuplicateDish = (dish: RestaurantDishItem) => {
    const copy: RestaurantDishItem = {
      ...dish,
      id: `dish-demo-${Date.now()}`,
      name: `${dish.name} (Copy)`,
      sku: `${dish.sku || 'RBH'}-CPY`,
      updatedAt: new Date().toISOString(),
    };
    const updated = [copy, ...dishes];
    setDishes(updated);
    saveStoredMenuDishes(updated);
    setNotice(`Duplicated "${dish.name}" as "${copy.name}".`);
    setTimeout(() => setNotice(''), 4000);
  };

  const handleDeleteDish = (dishId: string, dishName: string) => {
    if (!window.confirm(`Are you sure you want to delete "${dishName}" from the menu?`)) {
      return;
    }
    const updated = dishes.filter((d) => d.id !== dishId);
    setDishes(updated);
    saveStoredMenuDishes(updated);
    setNotice(`Dish "${dishName}" removed from menu.`);
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
    // Create placeholder dish in this category
    const placeholder: RestaurantDishItem = {
      id: `dish-demo-${Date.now()}`,
      name: `Sample Item in ${clean}`,
      category: clean,
      foodType: 'veg',
      basePrice: 150,
      sellingPrice: 150,
      prepTime: 15,
      isAvailable: true,
      description: `First dish in category ${clean}`,
      photos: [],
      primaryPhotoIndex: 0,
      variants: [{ id: `var-${Date.now()}`, name: 'Standard', price: 150, isAvailable: true }],
      addOnGroups: [],
      updatedAt: new Date().toISOString(),
    };
    const updated = [...dishes, placeholder];
    setDishes(updated);
    saveStoredMenuDishes(updated);
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
      setError(`Failed to export catalog: ${err?.message}`);
      setTimeout(() => setError(''), 4500);
    }
  };

  if (loading || !merchant) {
    return <div className="nabin-skeleton" style={{ minHeight: '100vh', border: 'none' }} />;
  }

  if (!hasRestaurant) {
    return (
      <ConsoleLayout title="Menu Management">
        <div className="nabin-stack">
          <div className="nabin-card" style={{ textAlign: 'center', padding: 'var(--space-xxl) var(--space-md)' }}>
            <div style={{ fontSize: 48, marginBottom: 'var(--space-md)' }}>🍽️</div>
            <h1 style={{ fontSize: 22, fontWeight: 800, marginBottom: 'var(--space-xs)' }}>
              Restaurant Module Not Enabled
            </h1>
            <p style={{ color: 'var(--ink-muted)', maxWidth: 480, margin: '0 auto var(--space-lg)' }}>
              Your merchant account is currently registered as a <strong>Grocery Partner</strong>. The restaurant kitchen menu module is only accessible to approved food service partners.
            </p>
            <Link href="/inventory" className="nabin-btn nabin-btn--primary">
              Go to Grocery Inventory &rarr;
            </Link>
          </div>
        </div>
      </ConsoleLayout>
    );
  }

  return (
    <ConsoleLayout title="Menu Management">
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
              Restaurant Menu Catalog
            </h1>
            <p style={{ fontSize: 13, color: 'var(--ink-muted)', margin: '4px 0 0' }}>
              Manage kitchen items, portion sizes, add-on groups, photos, and live dish availability.
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={handleExport}
              className="nabin-btn nabin-btn--ghost"
              style={{ minHeight: 40, fontSize: 13, color: '#1A3BA2', borderColor: '#1A3BA2' }}
              title="Export dishes as versioned JSON to import on Customer Web"
            >
              📥 Export Demo JSON
            </button>

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
              onClick={() => setShowAddModal(true)}
              className="nabin-btn nabin-btn--primary"
              style={{ minHeight: 40, padding: '0 20px', fontWeight: 800, fontSize: 14 }}
            >
              + Add New Dish
            </button>
          </div>
        </div>

        {/* Demo Cross-App Notice */}
        <div
          style={{
            padding: '12px 16px',
            background: '#EFF6FF',
            borderRadius: 10,
            border: '1px solid #BFDBFE',
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
              Export dishes as versioned JSON to import directly into Customer Web.
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

        {/* Notice & Alerts */}
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
              Menu items, photos, and variants are saved locally and synced with customer ordering and preview modals.
            </span>
          </div>
          <button
            type="button"
            onClick={() => {
              if (dishes.length > 0) setPreviewDish(dishes[0]);
            }}
            className="nabin-btn nabin-btn--ghost"
            style={{ minHeight: 32, fontSize: 12, padding: '0 12px' }}
          >
            👀 Test Customer View
          </button>
        </div>

        {/* Metrics Banner & Search Bar */}
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
          {/* Quick Metrics */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
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
                <div style={{ fontSize: 18, fontWeight: 800, lineHeight: 1 }}>{dishes.length}</div>
                <div style={{ fontSize: 11, color: 'var(--ink-muted)', fontWeight: 600 }}>Total Dishes</div>
              </div>
            </div>

            <div style={{ height: 28, width: 1, background: 'var(--divider)' }} />

            <div>
              <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--success-ink)', lineHeight: 1 }}>
                {inStockCount}
              </div>
              <div style={{ fontSize: 11, color: 'var(--ink-muted)', fontWeight: 600 }}>In Stock (Live)</div>
            </div>

            <div style={{ height: 28, width: 1, background: 'var(--divider)' }} />

            <div>
              <div
                style={{
                  fontSize: 18,
                  fontWeight: 800,
                  color: soldOutCount > 0 ? 'var(--danger-dark)' : 'var(--ink-muted)',
                  lineHeight: 1,
                }}
              >
                {soldOutCount}
              </div>
              <div style={{ fontSize: 11, color: 'var(--ink-muted)', fontWeight: 600 }}>Sold Out</div>
            </div>
          </div>

          {/* Search & Availability Filter */}
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
                placeholder="Search dish, description, SKU…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                style={{ paddingLeft: 36, minHeight: 40 }}
              />
            </div>

            <select
              className="nabin-select"
              value={availabilityFilter}
              onChange={(e) => setAvailabilityFilter(e.target.value as any)}
              style={{ width: 140, minHeight: 40, fontSize: 12 }}
            >
              <option value="ALL">All Status</option>
              <option value="AVAILABLE">🟢 In Stock</option>
              <option value="SOLDOUT">🔴 Sold Out</option>
            </select>
          </div>
        </div>

        {/* Category Pill Bar */}
        {filterCategories.length > 1 && (
          <div className="nabin-filter-pill-bar" role="tablist" aria-label="Menu categories">
            {filterCategories.map((cat) => {
              const active = selectedCategory === cat;
              const count = cat === 'ALL' ? dishes.length : dishes.filter((d) => d.category === cat).length;
              return (
                <button
                  key={cat}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  className={`nabin-filter-pill ${active ? 'nabin-filter-pill--active' : ''}`}
                  onClick={() => setSelectedCategory(cat)}
                >
                  <span>{cat === 'ALL' ? 'All Dishes' : cat}</span>
                  <span className="nabin-filter-pill__count">{count}</span>
                </button>
              );
            })}
          </div>
        )}

        {/* Dishes grouped by category */}
        {grouped.length === 0 ? (
          <div className="nabin-empty">
            <UtensilsIcon size={36} />
            <p style={{ marginTop: 12, fontWeight: 700, fontSize: 16 }}>
              {pending ? 'Loading menu…' : 'No menu items match your search or filter.'}
            </p>
            <button
              type="button"
              onClick={() => setShowAddModal(true)}
              className="nabin-btn nabin-btn--primary"
              style={{ marginTop: 14 }}
            >
              + Create First Dish
            </button>
          </div>
        ) : (
          grouped.map(([category, items]) => (
            <section key={category} className="nabin-card">
              <header className="nabin-card__header">
                <div>
                  <h2 style={{ fontSize: 18, fontWeight: 800, color: 'var(--ink)' }}>{category}</h2>
                  <p className="nabin-cell-meta">{items.length} dish{items.length > 1 ? 'es' : ''} in this category</p>
                </div>
              </header>

              <div className="nabin-table-wrap">
                <table className="nabin-table">
                  <thead>
                    <tr>
                      <th style={{ width: 60 }}>Photo</th>
                      <th style={{ width: 44 }}>Type</th>
                      <th>Dish Name & Description</th>
                      <th>Variants / Extras</th>
                      <th style={{ textAlign: 'right' }}>Price</th>
                      <th>Availability</th>
                      <th style={{ textAlign: 'right' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((dish) => {
                      const isLive = dish.isAvailable;
                      const primaryPhoto = dish.photos[dish.primaryPhotoIndex] || dish.photos[0] || '';
                      return (
                        <tr key={dish.id}>
                          {/* Dish Photo Thumbnail */}
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
                                  alt={dish.name}
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
                                🍲
                              </div>
                            )}
                          </td>

                          {/* Dietary Indicator */}
                          <td>
                            <span
                              title={
                                dish.foodType === 'veg'
                                  ? 'Vegetarian'
                                  : dish.foodType === 'non-veg'
                                    ? 'Non-Vegetarian'
                                    : dish.foodType === 'egg'
                                      ? 'Contains Egg'
                                      : 'Vegan'
                              }
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                width: 16,
                                height: 16,
                                border: `1.5px solid ${
                                  dish.foodType === 'veg' || dish.foodType === 'vegan'
                                    ? '#16a34a'
                                    : dish.foodType === 'egg'
                                      ? '#ca8a04'
                                      : '#dc2626'
                                }`,
                                borderRadius: 3,
                                padding: 2,
                              }}
                            >
                              <span
                                style={{
                                  width: 6,
                                  height: 6,
                                  borderRadius: '50%',
                                  background:
                                    dish.foodType === 'veg' || dish.foodType === 'vegan'
                                      ? '#16a34a'
                                      : dish.foodType === 'egg'
                                        ? '#ca8a04'
                                        : '#dc2626',
                                }}
                              />
                            </span>
                          </td>

                          {/* Name & Details */}
                          <td>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <span style={{ fontWeight: 800, color: 'var(--ink)', fontSize: 15 }}>
                                {dish.name}
                              </span>
                              {dish.isFeatured && (
                                <span className="nabin-badge nabin-badge--warning" style={{ fontSize: 10 }}>
                                  ⭐ Star
                                </span>
                              )}
                            </div>
                            {dish.shortDescription && (
                              <div style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: 2 }}>
                                {dish.shortDescription}
                              </div>
                            )}
                            <div style={{ display: 'flex', gap: 12, marginTop: 4, fontSize: 11, color: 'var(--ink-muted)' }}>
                              <span>⏱️ {dish.prepTime} mins</span>
                              <span>SKU: {dish.sku ?? '—'}</span>
                            </div>
                          </td>

                          {/* Variants / Add-on Summary */}
                          <td>
                            <div style={{ fontSize: 12 }}>
                              <span style={{ fontWeight: 700, color: 'var(--ink)' }}>
                                {dish.variants.length} variant{dish.variants.length > 1 ? 's' : ''}
                              </span>
                              {dish.variants.length > 0 && (
                                <span style={{ color: 'var(--ink-muted)', marginLeft: 4 }}>
                                  ({dish.variants.map((v) => v.name).join(', ')})
                                </span>
                              )}
                            </div>
                            <div style={{ fontSize: 11, color: 'var(--ink-muted)', marginTop: 2 }}>
                              {dish.addOnGroups.length} add-on group{dish.addOnGroups.length !== 1 ? 's' : ''}
                            </div>
                          </td>

                          {/* Price */}
                          <td style={{ textAlign: 'right', fontWeight: 800 }}>
                            <div style={{ fontSize: 15 }}>{inr(dish.sellingPrice || dish.basePrice)}</div>
                            {dish.mrp && dish.mrp > (dish.sellingPrice || dish.basePrice) && (
                              <div style={{ fontSize: 11, color: 'var(--ink-muted)', textDecoration: 'line-through' }}>
                                {inr(dish.mrp)}
                              </div>
                            )}
                          </td>

                          {/* Availability Toggle */}
                          <td>
                            <button
                              type="button"
                              role="switch"
                              aria-checked={isLive}
                              onClick={() => toggleAvailability(dish.id)}
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 8,
                                background: 'transparent',
                                border: 'none',
                                cursor: 'pointer',
                                padding: '4px 6px',
                                borderRadius: 9999,
                              }}
                              title={isLive ? 'Click to mark Sold Out' : 'Click to mark In Stock'}
                            >
                              <div
                                style={{
                                  width: 36,
                                  height: 20,
                                  borderRadius: 10,
                                  background: isLive ? 'var(--success)' : '#cbd5e1',
                                  position: 'relative',
                                  transition: 'background 0.2s ease',
                                }}
                              >
                                <div
                                  style={{
                                    width: 14,
                                    height: 14,
                                    borderRadius: '50%',
                                    background: '#ffffff',
                                    position: 'absolute',
                                    top: 3,
                                    left: isLive ? 19 : 3,
                                    transition: 'left 0.2s ease',
                                    boxShadow: '0 1px 2px rgba(0,0,0,0.2)',
                                  }}
                                />
                              </div>
                              <span
                                style={{
                                  fontSize: 12,
                                  fontWeight: 700,
                                  color: isLive ? 'var(--success-ink)' : 'var(--ink-muted)',
                                }}
                              >
                                {isLive ? 'Active' : 'Sold Out'}
                              </span>
                            </button>
                          </td>

                          {/* Action Buttons */}
                          <td style={{ textAlign: 'right' }}>
                            <div style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                              <button
                                type="button"
                                onClick={() => setPreviewDish(dish)}
                                className="nabin-btn nabin-btn--ghost"
                                style={{ minHeight: 32, padding: '0 10px', fontSize: 12 }}
                                title="Customer Preview"
                              >
                                👀 Preview
                              </button>

                              <button
                                type="button"
                                onClick={() => setEditingDish(dish)}
                                className="nabin-btn nabin-btn--ghost"
                                style={{ minHeight: 32, padding: '0 10px', fontSize: 12 }}
                                title="Edit Dish"
                              >
                                ✏️ Edit
                              </button>

                              <button
                                type="button"
                                onClick={() => handleDuplicateDish(dish)}
                                className="nabin-btn nabin-btn--ghost"
                                style={{ minHeight: 32, padding: '0 8px', fontSize: 12 }}
                                title="Duplicate Dish"
                              >
                                📋
                              </button>

                              <button
                                type="button"
                                onClick={() => handleDeleteDish(dish.id, dish.name)}
                                className="nabin-btn nabin-btn--ghost"
                                style={{
                                  minHeight: 32,
                                  padding: '0 8px',
                                  fontSize: 12,
                                  color: 'var(--danger)',
                                  borderColor: 'var(--danger-tint)',
                                }}
                                title="Delete Dish"
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
            </section>
          ))
        )}
      </div>

      {/* Add Dish Modal */}
      {showAddModal && (
        <DishFormModal
          categories={categories}
          onSave={handleSaveDish}
          onClose={() => setShowAddModal(false)}
        />
      )}

      {/* Edit Dish Modal */}
      {editingDish && (
        <DishFormModal
          initialDish={editingDish}
          categories={categories}
          onSave={handleSaveDish}
          onClose={() => setEditingDish(null)}
        />
      )}

      {/* Customer Preview Modal */}
      {previewDish && (
        <DishPreviewModal
          dish={previewDish}
          onClose={() => setPreviewDish(null)}
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
                Organize Menu Categories
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
                placeholder="New Category Name (e.g. Beverages, Rolls)…"
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
