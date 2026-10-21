'use client';

import { useRef, useState } from 'react';
import type { GroceryProductItem, GroceryProductVariant } from '@/lib/catalogData';
import { inr } from '@/lib/format';
import ProductPreviewModal from './ProductPreviewModal';

interface Props {
  initialProduct?: GroceryProductItem | null;
  categories: string[];
  onSave: (product: GroceryProductItem) => void;
  onClose: () => void;
}

export default function ProductFormModal({
  initialProduct,
  categories,
  onSave,
  onClose,
}: Props) {
  const isEditing = Boolean(initialProduct);

  // Form State
  const [name, setName] = useState(initialProduct?.name ?? '');
  const [brand, setBrand] = useState(initialProduct?.brand ?? '');
  const [category, setCategory] = useState(initialProduct?.category ?? (categories[0] || 'Staples & Grains'));
  const [customCategory, setCustomCategory] = useState('');
  const [subcategory, setSubcategory] = useState(initialProduct?.subcategory ?? '');
  const [sku, setSku] = useState(initialProduct?.sku ?? '');
  const [barcode, setBarcode] = useState(initialProduct?.barcode ?? '');
  const [description, setDescription] = useState(initialProduct?.description ?? '');
  const [unit, setUnit] = useState<GroceryProductItem['unit']>(initialProduct?.unit ?? 'kg');
  const [sellingPrice, setSellingPrice] = useState(String(initialProduct?.sellingPrice ?? '150'));
  const [mrp, setMrp] = useState(String(initialProduct?.mrp ?? '175'));
  const [stockQty, setStockQty] = useState(String(initialProduct?.stockQty ?? '25'));
  const [lowStockThreshold, setLowStockThreshold] = useState(String(initialProduct?.lowStockThreshold ?? '10'));
  const [isAvailable, setIsAvailable] = useState(initialProduct?.isAvailable ?? true);

  // Photos
  const [photos, setPhotos] = useState<string[]>(initialProduct?.photos ?? []);
  const [primaryPhotoIndex, setPrimaryPhotoIndex] = useState(initialProduct?.primaryPhotoIndex ?? 0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [photoError, setPhotoError] = useState('');

  // Variants
  const [variants, setVariants] = useState<GroceryProductVariant[]>(
    initialProduct?.variants ?? [
      {
        id: `gvar-${Date.now()}-1`,
        name: 'Standard Pack',
        packSize: '1kg',
        unit: 'kg',
        sellingPrice: Number(initialProduct?.sellingPrice || 150),
        mrp: Number(initialProduct?.mrp || 175),
        sku: initialProduct?.sku || `SKU-${Date.now().toString().slice(-4)}`,
        stockQty: Number(initialProduct?.stockQty || 25),
        isAvailable: true,
      },
    ],
  );

  // UI state
  const [error, setError] = useState('');
  const [showCustomerPreview, setShowCustomerPreview] = useState(false);
  const [isDirty, setIsDirty] = useState(false);

  // Helper to downscale and compress images on an HTML5 canvas (<60KB per photo)
  const compressImage = (file: File, maxDim = 800, quality = 0.82): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (event) => {
        const img = new Image();
        img.onload = () => {
          let width = img.width;
          let height = img.height;
          if (width > maxDim || height > maxDim) {
            if (width > height) {
              height = Math.round((height * maxDim) / width);
              width = maxDim;
            } else {
              width = Math.round((width * maxDim) / height);
              height = maxDim;
            }
          }
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            resolve(event.target?.result as string);
            return;
          }
          ctx.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL('image/jpeg', quality));
        };
        img.onerror = () => reject(new Error('Image decode failed'));
        img.src = event.target?.result as string;
      };
      reader.onerror = () => reject(new Error('File read failed'));
      reader.readAsDataURL(file);
    });
  };

  // File Upload Handler with canvas compression
  const handlePhotoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setPhotoError('');

    const maxFileSize = 5 * 1024 * 1024;
    const validTypes = ['image/jpeg', 'image/png', 'image/webp'];

    Array.from(files).forEach(async (file) => {
      if (!validTypes.includes(file.type)) {
        setPhotoError('Unsupported format. Please select PNG, JPG, or WebP.');
        return;
      }
      if (file.size > maxFileSize) {
        setPhotoError('Image file is too large. Max size is 5MB.');
        return;
      }

      try {
        const compressed = await compressImage(file);
        setPhotos((prev) => [...prev, compressed]);
        setIsDirty(true);
      } catch {
        setPhotoError('Failed to process image.');
      }
    });

    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removePhoto = (index: number) => {
    setPhotos((prev) => prev.filter((_, i) => i !== index));
    if (primaryPhotoIndex >= index && primaryPhotoIndex > 0) {
      setPrimaryPhotoIndex((p) => p - 1);
    }
    setIsDirty(true);
  };

  // Variants management
  const addVariant = () => {
    const newV: GroceryProductVariant = {
      id: `gvar-${Date.now()}-${variants.length + 1}`,
      name: `Pack ${variants.length + 1}`,
      packSize: `2 ${unit}`,
      unit,
      sellingPrice: Number(sellingPrice) * 2 || 200,
      mrp: Number(mrp) * 2 || 240,
      sku: `${sku || 'SKU'}-V${variants.length + 1}`,
      stockQty: 10,
      isAvailable: true,
    };
    setVariants([...variants, newV]);
    setIsDirty(true);
  };

  const updateVariant = (idx: number, patch: Partial<GroceryProductVariant>) => {
    setVariants((prev) => prev.map((v, i) => (i === idx ? { ...v, ...patch } : v)));
    setIsDirty(true);
  };

  const removeVariant = (idx: number) => {
    setVariants((prev) => prev.filter((_, i) => i !== idx));
    setIsDirty(true);
  };

  const currentSnapshot: GroceryProductItem = {
    id: initialProduct?.id ?? `prod-demo-${Date.now()}`,
    name: name.trim(),
    brand: brand.trim() || 'NABIN Select',
    category: category === '__NEW__' ? customCategory.trim() : category,
    subcategory: subcategory.trim(),
    sku: sku.trim() || `SKU-${Date.now().toString().slice(-6)}`,
    barcode: barcode.trim(),
    description: description.trim(),
    unit,
    sellingPrice: Number(sellingPrice) || 0,
    mrp: Number(mrp) || Number(sellingPrice) || 0,
    discountPercent:
      Number(mrp) > Number(sellingPrice)
        ? Math.round(((Number(mrp) - Number(sellingPrice)) / Number(mrp)) * 100)
        : 0,
    stockQty: Number(stockQty) || 0,
    lowStockThreshold: Number(lowStockThreshold) || 5,
    isAvailable,
    photos: photos.length > 0 ? photos : ['https://images.unsplash.com/photo-1542838132-92c53300491e?w=600&auto=format&fit=crop&q=80'],
    primaryPhotoIndex: primaryPhotoIndex < photos.length ? primaryPhotoIndex : 0,
    variants,
    updatedAt: new Date().toISOString(),
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!name.trim()) {
      setError('Product name is required.');
      return;
    }

    const finalCat = category === '__NEW__' ? customCategory.trim() : category;
    if (!finalCat) {
      setError('Product category is required.');
      return;
    }

    const numPrice = Number(sellingPrice);
    if (isNaN(numPrice) || numPrice < 0) {
      setError('Selling price must be a valid non-negative number.');
      return;
    }

    const numStock = Number(stockQty);
    if (isNaN(numStock) || numStock < 0) {
      setError('Stock quantity must be a non-negative number.');
      return;
    }

    for (const v of variants) {
      if (!v.name.trim()) {
        setError('All variants must have a name.');
        return;
      }
      if (isNaN(v.sellingPrice) || v.sellingPrice < 0) {
        setError(`Variant "${v.name}" price must be non-negative.`);
        return;
      }
    }

    onSave(currentSnapshot);
  };

  const handleCancel = () => {
    if (isDirty) {
      if (!window.confirm('You have unsaved changes. Discard and close?')) {
        return;
      }
    }
    onClose();
  };

  return (
    <>
      <div
        role="dialog"
        aria-modal="true"
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 9998,
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
            borderRadius: 20,
            width: '100%',
            maxWidth: 780,
            maxHeight: '92vh',
            display: 'flex',
            flexDirection: 'column',
            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
            overflow: 'hidden',
          }}
        >
          {/* Header */}
          <div
            style={{
              padding: '18px 24px',
              borderBottom: '1px solid var(--divider)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              background: '#f8fafc',
            }}
          >
            <div>
              <h2 style={{ fontSize: 18, fontWeight: 800, margin: 0, color: 'var(--ink)' }}>
                {isEditing ? `Edit Product: ${initialProduct?.name}` : 'Add New Grocery Product'}
              </h2>
              <p style={{ fontSize: 12, margin: '2px 0 0', color: 'var(--ink-muted)' }}>
                Configure grocery catalog details, unit of sale, photo preview, pack sizes, and stock.
              </p>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <button
                type="button"
                onClick={() => setShowCustomerPreview(true)}
                className="nabin-btn nabin-btn--ghost"
                style={{ fontSize: 13, gap: 6, minHeight: 36 }}
                title="Preview how customer sees this grocery product"
              >
                <span>👀</span>
                <span>Live Preview</span>
              </button>
              <button
                type="button"
                onClick={handleCancel}
                className="nabin-btn nabin-btn--ghost"
                style={{ minHeight: 36, padding: '0 10px' }}
              >
                ✕
              </button>
            </div>
          </div>

          {/* Form */}
          <form
            onSubmit={handleSubmit}
            style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', flex: 1 }}
          >
            <div style={{ overflowY: 'auto', padding: '24px', display: 'flex', flexDirection: 'column', gap: 24, flex: 1 }}>
              {error && (
                <div className="nabin-alert nabin-alert--danger" role="alert" style={{ marginBottom: 0 }}>
                  <span>{error}</span>
                </div>
              )}

              {/* SECTION 1: Product Basic Information */}
              <section>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                  <span style={{ fontSize: 18 }}>📦</span>
                  <h3 style={{ fontSize: 15, fontWeight: 800, margin: 0, color: 'var(--ink)' }}>
                    Product Details & Brand
                  </h3>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                  <div style={{ gridColumn: 'span 2' }}>
                    <label className="nabin-label" htmlFor="prod-name-input">
                      Product Name <span style={{ color: 'var(--danger)' }}>*</span>
                    </label>
                    <input
                      id="prod-name-input"
                      className="nabin-input"
                      type="text"
                      placeholder="e.g. Aashirvaad Shudh Chakki Atta"
                      value={name}
                      onChange={(e) => {
                        setName(e.target.value);
                        setIsDirty(true);
                      }}
                      required
                    />
                  </div>

                  <div>
                    <label className="nabin-label" htmlFor="prod-brand-input">
                      Brand
                    </label>
                    <input
                      id="prod-brand-input"
                      className="nabin-input"
                      type="text"
                      placeholder="e.g. Aashirvaad, Fortune, Tata"
                      value={brand}
                      onChange={(e) => {
                        setBrand(e.target.value);
                        setIsDirty(true);
                      }}
                    />
                  </div>

                  <div>
                    <label className="nabin-label" htmlFor="prod-cat-select">
                      Category <span style={{ color: 'var(--danger)' }}>*</span>
                    </label>
                    <select
                      id="prod-cat-select"
                      className="nabin-select"
                      value={category}
                      onChange={(e) => {
                        setCategory(e.target.value);
                        setIsDirty(true);
                      }}
                      required
                    >
                      {categories.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                      <option value="__NEW__">+ Create New Category…</option>
                    </select>
                    {category === '__NEW__' && (
                      <input
                        className="nabin-input"
                        style={{ marginTop: 8 }}
                        placeholder="Enter category name…"
                        value={customCategory}
                        onChange={(e) => {
                          setCustomCategory(e.target.value);
                          setIsDirty(true);
                        }}
                        required
                      />
                    )}
                  </div>

                  <div>
                    <label className="nabin-label" htmlFor="prod-subcat-input">
                      Subcategory
                    </label>
                    <input
                      id="prod-subcat-input"
                      className="nabin-input"
                      type="text"
                      placeholder="e.g. Flour & Atta, Edible Oil"
                      value={subcategory}
                      onChange={(e) => {
                        setSubcategory(e.target.value);
                        setIsDirty(true);
                      }}
                    />
                  </div>

                  <div>
                    <label className="nabin-label" htmlFor="prod-unit-select">
                      Unit of Sale <span style={{ color: 'var(--danger)' }}>*</span>
                    </label>
                    <select
                      id="prod-unit-select"
                      className="nabin-select"
                      value={unit}
                      onChange={(e) => {
                        setUnit(e.target.value as any);
                        setIsDirty(true);
                      }}
                    >
                      <option value="kg">Kilogram (kg)</option>
                      <option value="g">Gram (g)</option>
                      <option value="litre">Litre (L)</option>
                      <option value="ml">Millilitre (ml)</option>
                      <option value="piece">Piece (pc)</option>
                      <option value="pack">Pack / Box</option>
                    </select>
                  </div>

                  <div>
                    <label className="nabin-label" htmlFor="prod-sku-input">
                      SKU Code
                    </label>
                    <input
                      id="prod-sku-input"
                      className="nabin-input"
                      type="text"
                      placeholder="e.g. ASH-AT-05K"
                      value={sku}
                      onChange={(e) => {
                        setSku(e.target.value);
                        setIsDirty(true);
                      }}
                    />
                  </div>

                  <div>
                    <label className="nabin-label" htmlFor="prod-barcode-input">
                      Barcode / EAN
                    </label>
                    <input
                      id="prod-barcode-input"
                      className="nabin-input"
                      type="text"
                      placeholder="e.g. 8901030382910"
                      value={barcode}
                      onChange={(e) => {
                        setBarcode(e.target.value);
                        setIsDirty(true);
                      }}
                    />
                  </div>

                  <div style={{ gridColumn: 'span 2' }}>
                    <label className="nabin-label" htmlFor="prod-desc-input">
                      Product Description
                    </label>
                    <textarea
                      id="prod-desc-input"
                      className="nabin-input"
                      rows={2}
                      placeholder="Ingredients, quality highlights, storage instructions…"
                      value={description}
                      onChange={(e) => {
                        setDescription(e.target.value);
                        setIsDirty(true);
                      }}
                    />
                  </div>
                </div>
              </section>

              {/* SECTION 2: Photos */}
              <section
                style={{
                  padding: 16,
                  borderRadius: 12,
                  background: '#f8fafc',
                  border: '1px solid #e2e8f0',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 18 }}>📸</span>
                    <h3 style={{ fontSize: 15, fontWeight: 800, margin: 0, color: 'var(--ink)' }}>
                      Product Images
                    </h3>
                  </div>
                  <span className="nabin-badge nabin-badge--warning" style={{ fontSize: 10 }}>
                    Local Demo Preview
                  </span>
                </div>

                {photoError && (
                  <div className="nabin-alert nabin-alert--danger" style={{ marginBottom: 12 }}>
                    <span>{photoError}</span>
                  </div>
                )}

                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                  {photos.map((src, idx) => {
                    const isPrimary = idx === primaryPhotoIndex;
                    return (
                      <div
                        key={idx}
                        style={{
                          position: 'relative',
                          width: 100,
                          height: 100,
                          borderRadius: 12,
                          overflow: 'hidden',
                          border: isPrimary ? '2.5px solid var(--brand)' : '1px solid #cbd5e1',
                          background: '#ffffff',
                          boxShadow: '0 2px 4px rgba(0,0,0,0.06)',
                        }}
                      >
                        <img
                          src={src}
                          alt={`Product photo ${idx + 1}`}
                          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                        />
                        {isPrimary && (
                          <div
                            style={{
                              position: 'absolute',
                              bottom: 0,
                              left: 0,
                              right: 0,
                              background: 'var(--brand)',
                              color: '#ffffff',
                              fontSize: 9,
                              fontWeight: 800,
                              textAlign: 'center',
                              padding: '2px 0',
                            }}
                          >
                            PRIMARY
                          </div>
                        )}
                        <div style={{ position: 'absolute', top: 4, right: 4, display: 'flex', gap: 4 }}>
                          {!isPrimary && (
                            <button
                              type="button"
                              onClick={() => {
                                setPrimaryPhotoIndex(idx);
                                setIsDirty(true);
                              }}
                              style={{
                                background: 'rgba(15, 23, 42, 0.75)',
                                color: '#ffffff',
                                border: 'none',
                                borderRadius: 4,
                                width: 20,
                                height: 20,
                                fontSize: 10,
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                              }}
                              title="Set as Primary"
                            >
                              ★
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => removePhoto(idx)}
                            style={{
                              background: 'rgba(220, 38, 38, 0.85)',
                              color: '#ffffff',
                              border: 'none',
                              borderRadius: 4,
                              width: 20,
                              height: 20,
                              fontSize: 10,
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                            }}
                            title="Remove Photo"
                          >
                            ✕
                          </button>
                        </div>
                      </div>
                    );
                  })}

                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    style={{
                      width: 100,
                      height: 100,
                      borderRadius: 12,
                      border: '2px dashed #94a3b8',
                      background: '#ffffff',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: 'pointer',
                      gap: 4,
                      color: 'var(--ink-muted)',
                    }}
                  >
                    <span style={{ fontSize: 22 }}>📷</span>
                    <span style={{ fontSize: 11, fontWeight: 700 }}>+ Add Photo</span>
                  </button>
                </div>

                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png, image/jpeg, image/webp"
                  multiple
                  style={{ display: 'none' }}
                  onChange={handlePhotoSelect}
                />
              </section>

              {/* SECTION 3: Pricing & Stock Inventory */}
              <section>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                  <span style={{ fontSize: 18 }}>💰</span>
                  <h3 style={{ fontSize: 15, fontWeight: 800, margin: 0, color: 'var(--ink)' }}>
                    Standard Price & Stock
                  </h3>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 14 }}>
                  <div>
                    <label className="nabin-label" htmlFor="prod-price-input">
                      Selling Price (₹) <span style={{ color: 'var(--danger)' }}>*</span>
                    </label>
                    <input
                      id="prod-price-input"
                      className="nabin-input"
                      type="number"
                      min="0"
                      step="0.01"
                      value={sellingPrice}
                      onChange={(e) => {
                        setSellingPrice(e.target.value);
                        setIsDirty(true);
                      }}
                      required
                    />
                  </div>

                  <div>
                    <label className="nabin-label" htmlFor="prod-mrp-input">
                      MRP / Cut Price (₹)
                    </label>
                    <input
                      id="prod-mrp-input"
                      className="nabin-input"
                      type="number"
                      min="0"
                      step="0.01"
                      value={mrp}
                      onChange={(e) => {
                        setMrp(e.target.value);
                        setIsDirty(true);
                      }}
                    />
                  </div>

                  <div>
                    <label className="nabin-label" htmlFor="prod-stock-input">
                      Stock Quantity <span style={{ color: 'var(--danger)' }}>*</span>
                    </label>
                    <input
                      id="prod-stock-input"
                      className="nabin-input"
                      type="number"
                      min="0"
                      value={stockQty}
                      onChange={(e) => {
                        setStockQty(e.target.value);
                        setIsDirty(true);
                      }}
                      required
                    />
                  </div>

                  <div>
                    <label className="nabin-label" htmlFor="prod-thresh-input">
                      Low-Stock Alert
                    </label>
                    <input
                      id="prod-thresh-input"
                      className="nabin-input"
                      type="number"
                      min="1"
                      value={lowStockThreshold}
                      onChange={(e) => {
                        setLowStockThreshold(e.target.value);
                        setIsDirty(true);
                      }}
                    />
                  </div>
                </div>

                <div style={{ marginTop: 12 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={isAvailable}
                      onChange={(e) => {
                        setIsAvailable(e.target.checked);
                        setIsDirty(true);
                      }}
                    />
                    <span className="nabin-label" style={{ marginBottom: 0 }}>
                      Available for Customer Ordering
                    </span>
                  </label>
                </div>
              </section>

              {/* SECTION 4: Pack Size Variants */}
              <section
                style={{
                  padding: 16,
                  borderRadius: 12,
                  background: '#f8fafc',
                  border: '1px solid #e2e8f0',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                  <div>
                    <h3 style={{ fontSize: 15, fontWeight: 800, margin: 0, color: 'var(--ink)' }}>
                      Pack Size / Weight Variants
                    </h3>
                    <p style={{ fontSize: 11, color: 'var(--ink-muted)', margin: 0 }}>
                      Support multipacks, 500g vs 1kg, or 1L vs 5L with dedicated price and stock.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={addVariant}
                    className="nabin-btn nabin-btn--ghost"
                    style={{ minHeight: 32, fontSize: 12, padding: '0 12px' }}
                  >
                    + Add Pack Variant
                  </button>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {variants.map((v, idx) => (
                    <div
                      key={v.id}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '1.2fr 90px 100px 90px 80px 32px',
                        gap: 8,
                        alignItems: 'center',
                        background: '#ffffff',
                        padding: '10px 12px',
                        borderRadius: 8,
                        border: '1px solid #e2e8f0',
                      }}
                    >
                      <input
                        className="nabin-input"
                        placeholder="Variant name"
                        value={v.name}
                        onChange={(e) => updateVariant(idx, { name: e.target.value })}
                        style={{ minHeight: 34, fontSize: 12 }}
                        required
                      />
                      <input
                        className="nabin-input"
                        placeholder="Pack (5kg)"
                        value={v.packSize}
                        onChange={(e) => updateVariant(idx, { packSize: e.target.value })}
                        style={{ minHeight: 34, fontSize: 12 }}
                      />
                      <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                        <span style={{ fontSize: 12, color: 'var(--ink-muted)' }}>₹</span>
                        <input
                          className="nabin-input"
                          type="number"
                          min="0"
                          value={v.sellingPrice}
                          onChange={(e) => updateVariant(idx, { sellingPrice: Number(e.target.value) || 0 })}
                          style={{ minHeight: 34, fontSize: 12 }}
                          required
                        />
                      </div>
                      <input
                        className="nabin-input"
                        type="number"
                        min="0"
                        placeholder="Stock"
                        value={v.stockQty}
                        onChange={(e) => updateVariant(idx, { stockQty: Number(e.target.value) || 0 })}
                        style={{ minHeight: 34, fontSize: 12 }}
                      />
                      <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={v.isAvailable}
                          onChange={(e) => updateVariant(idx, { isAvailable: e.target.checked })}
                        />
                        <span>Active</span>
                      </label>
                      <button
                        type="button"
                        onClick={() => removeVariant(idx)}
                        disabled={variants.length <= 1}
                        style={{
                          border: 'none',
                          background: 'transparent',
                          color: variants.length <= 1 ? '#cbd5e1' : 'var(--danger)',
                          cursor: variants.length <= 1 ? 'not-allowed' : 'pointer',
                          fontSize: 14,
                        }}
                        title="Remove Variant"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            </div>

            {/* Footer */}
            <div
              style={{
                padding: '16px 24px',
                borderTop: '1px solid var(--divider)',
                background: '#ffffff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <button
                type="button"
                onClick={handleCancel}
                className="nabin-btn nabin-btn--ghost"
                style={{ minHeight: 40 }}
              >
                Cancel
              </button>

              <div style={{ display: 'flex', gap: 12 }}>
                <button
                  type="button"
                  onClick={() => setShowCustomerPreview(true)}
                  className="nabin-btn nabin-btn--ghost"
                  style={{ minHeight: 40 }}
                >
                  Test Preview
                </button>
                <button
                  type="submit"
                  className="nabin-btn nabin-btn--primary"
                  style={{ minHeight: 40, padding: '0 24px', fontWeight: 800 }}
                >
                  {isEditing ? 'Save Changes' : 'Create & Save Product'}
                </button>
              </div>
            </div>
          </form>
        </div>
      </div>

      {showCustomerPreview && (
        <ProductPreviewModal
          product={currentSnapshot}
          onClose={() => setShowCustomerPreview(false)}
        />
      )}
    </>
  );
}
