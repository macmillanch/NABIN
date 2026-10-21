'use client';

import { useRef, useState } from 'react';
import type { DishAddOnGroup, DishVariant, RestaurantDishItem } from '@/lib/catalogData';
import { inr } from '@/lib/format';
import DishPreviewModal from './DishPreviewModal';

interface Props {
  initialDish?: RestaurantDishItem | null;
  categories: string[];
  onSave: (dish: RestaurantDishItem) => void;
  onClose: () => void;
}

export default function DishFormModal({
  initialDish,
  categories,
  onSave,
  onClose,
}: Props) {
  const isEditing = Boolean(initialDish);

  // Basic Details
  const [name, setName] = useState(initialDish?.name ?? '');
  const [shortDescription, setShortDescription] = useState(initialDish?.shortDescription ?? '');
  const [description, setDescription] = useState(initialDish?.description ?? '');
  const [category, setCategory] = useState(initialDish?.category ?? (categories[0] || 'Main Course'));
  const [customCategory, setCustomCategory] = useState('');
  const [foodType, setFoodType] = useState<RestaurantDishItem['foodType']>(initialDish?.foodType ?? 'veg');
  const [basePrice, setBasePrice] = useState(String(initialDish?.basePrice ?? '250'));
  const [sellingPrice, setSellingPrice] = useState(String(initialDish?.sellingPrice ?? initialDish?.basePrice ?? '250'));
  const [mrp, setMrp] = useState(String(initialDish?.mrp ?? initialDish?.basePrice ?? '280'));
  const [prepTime, setPrepTime] = useState(String(initialDish?.prepTime ?? '20'));
  const [isAvailable, setIsAvailable] = useState(initialDish?.isAvailable ?? true);
  const [isFeatured, setIsFeatured] = useState(initialDish?.isFeatured ?? false);
  const [sku, setSku] = useState(initialDish?.sku ?? '');

  // Photos
  const [photos, setPhotos] = useState<string[]>(initialDish?.photos ?? []);
  const [primaryPhotoIndex, setPrimaryPhotoIndex] = useState(initialDish?.primaryPhotoIndex ?? 0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [photoError, setPhotoError] = useState('');

  // Variants
  const [variants, setVariants] = useState<DishVariant[]>(
    initialDish?.variants ?? [
      { id: `var-${Date.now()}-1`, name: 'Regular', price: Number(initialDish?.basePrice || 250), isAvailable: true },
      { id: `var-${Date.now()}-2`, name: 'Large', price: Number(initialDish?.basePrice || 250) + 120, isAvailable: true },
    ],
  );

  // Add-on Groups
  const [addOnGroups, setAddOnGroups] = useState<DishAddOnGroup[]>(initialDish?.addOnGroups ?? []);

  // Validation & UI State
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

  // Handle Photo File Upload with canvas compression
  const handlePhotoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setPhotoError('');

    const maxFileSize = 5 * 1024 * 1024; // 5MB
    const validTypes = ['image/jpeg', 'image/png', 'image/webp'];

    Array.from(files).forEach(async (file) => {
      if (!validTypes.includes(file.type)) {
        setPhotoError('Unsupported format. Please select PNG, JPG, or WebP images.');
        return;
      }
      if (file.size > maxFileSize) {
        setPhotoError('Image file is too large. Max allowed size is 5MB.');
        return;
      }

      try {
        const compressed = await compressImage(file);
        setPhotos((prev) => [...prev, compressed]);
        setIsDirty(true);
      } catch {
        setPhotoError('Failed to process image file.');
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

  // Variants helpers
  const addVariant = () => {
    const newVar: DishVariant = {
      id: `var-${Date.now()}-${variants.length + 1}`,
      name: `Size ${variants.length + 1}`,
      price: Number(basePrice) || 0,
      isAvailable: true,
    };
    setVariants([...variants, newVar]);
    setIsDirty(true);
  };

  const updateVariant = (idx: number, patch: Partial<DishVariant>) => {
    setVariants((prev) =>
      prev.map((v, i) => (i === idx ? { ...v, ...patch } : v)),
    );
    setIsDirty(true);
  };

  const removeVariant = (idx: number) => {
    setVariants((prev) => prev.filter((_, i) => i !== idx));
    setIsDirty(true);
  };

  // Add-on groups helpers
  const addAddOnGroup = () => {
    const newGroup: DishAddOnGroup = {
      id: `grp-${Date.now()}`,
      name: 'Toppings & Extras',
      isRequired: false,
      selectionType: 'multi',
      minSelect: 0,
      maxSelect: 3,
      options: [
        { id: `opt-${Date.now()}-1`, name: 'Extra Cheese', price: 40, isDefault: false, isAvailable: true },
        { id: `opt-${Date.now()}-2`, name: 'Dip Sauce', price: 25, isDefault: false, isAvailable: true },
      ],
    };
    setAddOnGroups([...addOnGroups, newGroup]);
    setIsDirty(true);
  };

  const updateGroup = (groupIdx: number, patch: Partial<DishAddOnGroup>) => {
    setAddOnGroups((prev) =>
      prev.map((g, i) => (i === groupIdx ? { ...g, ...patch } : g)),
    );
    setIsDirty(true);
  };

  const removeGroup = (groupIdx: number) => {
    setAddOnGroups((prev) => prev.filter((_, i) => i !== groupIdx));
    setIsDirty(true);
  };

  const addOptionToGroup = (groupIdx: number) => {
    setAddOnGroups((prev) =>
      prev.map((g, i) => {
        if (i !== groupIdx) return g;
        const newOpt = {
          id: `opt-${Date.now()}-${g.options.length + 1}`,
          name: 'New Option',
          price: 30,
          isDefault: false,
          isAvailable: true,
        };
        return { ...g, options: [...g.options, newOpt] };
      }),
    );
    setIsDirty(true);
  };

  const updateOption = (groupIdx: number, optIdx: number, patch: Partial<DishAddOnGroup['options'][0]>) => {
    setAddOnGroups((prev) =>
      prev.map((g, gi) => {
        if (gi !== groupIdx) return g;
        return {
          ...g,
          options: g.options.map((o, oi) => (oi === optIdx ? { ...o, ...patch } : o)),
        };
      }),
    );
    setIsDirty(true);
  };

  const removeOption = (groupIdx: number, optIdx: number) => {
    setAddOnGroups((prev) =>
      prev.map((g, gi) => {
        if (gi !== groupIdx) return g;
        return {
          ...g,
          options: g.options.filter((_, oi) => oi !== optIdx),
        };
      }),
    );
    setIsDirty(true);
  };

  const currentDishSnapshot: RestaurantDishItem = {
    id: initialDish?.id ?? `dish-demo-${Date.now()}`,
    name: name.trim(),
    shortDescription: shortDescription.trim(),
    description: description.trim(),
    category: category === '__NEW__' ? customCategory.trim() : category,
    foodType,
    sku: sku.trim() || `RBH-${name.substring(0, 3).toUpperCase()}-${Date.now().toString().slice(-3)}`,
    basePrice: Number(basePrice) || 0,
    sellingPrice: Number(sellingPrice) || Number(basePrice) || 0,
    mrp: Number(mrp) || Number(basePrice) || 0,
    discountPercent:
      Number(mrp) > Number(sellingPrice)
        ? Math.round(((Number(mrp) - Number(sellingPrice)) / Number(mrp)) * 100)
        : 0,
    prepTime: Number(prepTime) || 15,
    isAvailable,
    isFeatured,
    photos: photos.length > 0 ? photos : ['https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=600&auto=format&fit=crop&q=80'],
    primaryPhotoIndex: primaryPhotoIndex < photos.length ? primaryPhotoIndex : 0,
    variants,
    addOnGroups,
    updatedAt: new Date().toISOString(),
  };

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!name.trim()) {
      setError('Dish name is required.');
      return;
    }

    const finalCat = category === '__NEW__' ? customCategory.trim() : category;
    if (!finalCat) {
      setError('Menu category is required.');
      return;
    }

    const numBase = Number(basePrice);
    if (isNaN(numBase) || numBase < 0) {
      setError('Base price must be a valid non-negative number.');
      return;
    }

    for (const v of variants) {
      if (!v.name.trim()) {
        setError('All variants must have a name.');
        return;
      }
      if (isNaN(v.price) || v.price < 0) {
        setError(`Variant "${v.name}" price must be non-negative.`);
        return;
      }
    }

    for (const g of addOnGroups) {
      if (!g.name.trim()) {
        setError('All add-on groups must have a title.');
        return;
      }
      for (const opt of g.options) {
        if (!opt.name.trim()) {
          setError(`Option in group "${g.name}" requires a name.`);
          return;
        }
        if (isNaN(opt.price) || opt.price < 0) {
          setError(`Option "${opt.name}" price must be non-negative.`);
          return;
        }
      }
    }

    onSave(currentDishSnapshot);
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
                {isEditing ? `Edit Dish: ${initialDish?.name}` : 'Add New Restaurant Dish'}
              </h2>
              <p style={{ fontSize: 12, margin: '2px 0 0', color: 'var(--ink-muted)' }}>
                Configure dish details, photos, sizing variants, and add-on groups.
              </p>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <button
                type="button"
                onClick={() => setShowCustomerPreview(true)}
                className="nabin-btn nabin-btn--ghost"
                style={{ fontSize: 13, gap: 6, minHeight: 36 }}
                title="Preview how customer sees this dish"
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

          {/* Form body */}
          <form
            onSubmit={handleFormSubmit}
            style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', flex: 1 }}
          >
            <div style={{ overflowY: 'auto', padding: '24px', display: 'flex', flexDirection: 'column', gap: 24, flex: 1 }}>
              {error && (
                <div className="nabin-alert nabin-alert--danger" role="alert" style={{ marginBottom: 0 }}>
                  <span>{error}</span>
                </div>
              )}

              {/* SECTION 1: Dish Basic Information */}
              <section>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                  <span style={{ fontSize: 18 }}>📝</span>
                  <h3 style={{ fontSize: 15, fontWeight: 800, margin: 0, color: 'var(--ink)' }}>
                    Basic Dish Details
                  </h3>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                  <div style={{ gridColumn: 'span 2' }}>
                    <label className="nabin-label" htmlFor="dish-name-input">
                      Dish Name <span style={{ color: 'var(--danger)' }}>*</span>
                    </label>
                    <input
                      id="dish-name-input"
                      className="nabin-input"
                      type="text"
                      placeholder="e.g. Royal Chicken Dum Biryani"
                      value={name}
                      onChange={(e) => {
                        setName(e.target.value);
                        setIsDirty(true);
                      }}
                      required
                    />
                  </div>

                  <div>
                    <label className="nabin-label" htmlFor="dish-cat-select">
                      Category <span style={{ color: 'var(--danger)' }}>*</span>
                    </label>
                    <select
                      id="dish-cat-select"
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
                        placeholder="Enter new category name…"
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
                    <label className="nabin-label" htmlFor="dish-food-type">
                      Dietary / Food Type
                    </label>
                    <select
                      id="dish-food-type"
                      className="nabin-select"
                      value={foodType}
                      onChange={(e) => {
                        setFoodType(e.target.value as any);
                        setIsDirty(true);
                      }}
                    >
                      <option value="veg">🟢 Pure Vegetarian</option>
                      <option value="non-veg">🔴 Non-Vegetarian</option>
                      <option value="egg">🟡 Contains Egg</option>
                      <option value="vegan">🌱 100% Plant-Based Vegan</option>
                    </select>
                  </div>

                  <div>
                    <label className="nabin-label" htmlFor="dish-base-price">
                      Base Price (₹) <span style={{ color: 'var(--danger)' }}>*</span>
                    </label>
                    <input
                      id="dish-base-price"
                      className="nabin-input"
                      type="number"
                      min="0"
                      step="1"
                      value={basePrice}
                      onChange={(e) => {
                        setBasePrice(e.target.value);
                        setIsDirty(true);
                      }}
                      required
                    />
                  </div>

                  <div>
                    <label className="nabin-label" htmlFor="dish-prep-time">
                      Preparation Time (minutes)
                    </label>
                    <input
                      id="dish-prep-time"
                      className="nabin-input"
                      type="number"
                      min="1"
                      value={prepTime}
                      onChange={(e) => {
                        setPrepTime(e.target.value);
                        setIsDirty(true);
                      }}
                    />
                  </div>

                  <div style={{ gridColumn: 'span 2' }}>
                    <label className="nabin-label" htmlFor="dish-short-desc">
                      Short Tagline
                    </label>
                    <input
                      id="dish-short-desc"
                      className="nabin-input"
                      type="text"
                      placeholder="e.g. Slow-cooked in copper handi with aged saffron basmati"
                      value={shortDescription}
                      onChange={(e) => {
                        setShortDescription(e.target.value);
                        setIsDirty(true);
                      }}
                    />
                  </div>

                  <div style={{ gridColumn: 'span 2' }}>
                    <label className="nabin-label" htmlFor="dish-full-desc">
                      Full Menu Description
                    </label>
                    <textarea
                      id="dish-full-desc"
                      className="nabin-input"
                      rows={3}
                      placeholder="Describe flavours, ingredients, accompaniments, allergens…"
                      value={description}
                      onChange={(e) => {
                        setDescription(e.target.value);
                        setIsDirty(true);
                      }}
                    />
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
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
                        Currently Available in Kitchen
                      </span>
                    </label>

                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={isFeatured}
                        onChange={(e) => {
                          setIsFeatured(e.target.checked);
                          setIsDirty(true);
                        }}
                      />
                      <span className="nabin-label" style={{ marginBottom: 0 }}>
                        Featured Star Dish ⭐
                      </span>
                    </label>
                  </div>
                </div>
              </section>

              {/* SECTION 2: Photos & Gallery */}
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
                      Dish Photographs
                    </h3>
                  </div>
                  <span className="nabin-badge nabin-badge--warning" style={{ fontSize: 10 }}>
                    Local Demo Session Preview
                  </span>
                </div>

                <p style={{ fontSize: 12, color: 'var(--ink-muted)', margin: '0 0 12px' }}>
                  Upload high resolution dish photos. Select your primary card image. Photos render immediately in customer menu and preview modals.
                </p>

                {photoError && (
                  <div className="nabin-alert nabin-alert--danger" style={{ marginBottom: 12 }}>
                    <span>{photoError}</span>
                  </div>
                )}

                {/* Photo Previews */}
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
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
                          alt={`Dish photo ${idx + 1}`}
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
                        <div
                          style={{
                            position: 'absolute',
                            top: 4,
                            right: 4,
                            display: 'flex',
                            gap: 4,
                          }}
                        >
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

                  {/* Add Photo Button */}
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

              {/* SECTION 3: Dish Variants */}
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
                      Portion Sizes & Variants
                    </h3>
                    <p style={{ fontSize: 11, color: 'var(--ink-muted)', margin: 0 }}>
                      Define options like Half / Full or Regular / Large with independent pricing.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={addVariant}
                    className="nabin-btn nabin-btn--ghost"
                    style={{ minHeight: 32, fontSize: 12, padding: '0 12px' }}
                  >
                    + Add Size Variant
                  </button>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {variants.map((v, idx) => (
                    <div
                      key={v.id}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '1fr 140px 100px 36px',
                        gap: 12,
                        alignItems: 'center',
                        background: '#ffffff',
                        padding: '10px 14px',
                        borderRadius: 8,
                        border: '1px solid #e2e8f0',
                      }}
                    >
                      <input
                        className="nabin-input"
                        placeholder="Variant name (e.g. Regular, Large)"
                        value={v.name}
                        onChange={(e) => updateVariant(idx, { name: e.target.value })}
                        style={{ minHeight: 36 }}
                        required
                      />
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <span style={{ fontSize: 13, color: 'var(--ink-muted)' }}>₹</span>
                        <input
                          className="nabin-input"
                          type="number"
                          min="0"
                          value={v.price}
                          onChange={(e) => updateVariant(idx, { price: Number(e.target.value) || 0 })}
                          style={{ minHeight: 36 }}
                          required
                        />
                      </div>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={v.isAvailable}
                          onChange={(e) => updateVariant(idx, { isAvailable: e.target.checked })}
                        />
                        <span>In stock</span>
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

              {/* SECTION 4: Add-On Groups */}
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
                      Custom Add-On Groups & Extras
                    </h3>
                    <p style={{ fontSize: 11, color: 'var(--ink-muted)', margin: 0 }}>
                      Configure toppings, choice of bread, drinks, sides, or required choices.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={addAddOnGroup}
                    className="nabin-btn nabin-btn--ghost"
                    style={{ minHeight: 32, fontSize: 12, padding: '0 12px' }}
                  >
                    + Add New Group
                  </button>
                </div>

                {addOnGroups.length === 0 ? (
                  <div
                    style={{
                      textAlign: 'center',
                      padding: 24,
                      background: '#ffffff',
                      borderRadius: 8,
                      border: '1px dashed #cbd5e1',
                      color: 'var(--ink-muted)',
                      fontSize: 13,
                    }}
                  >
                    No add-on groups configured yet. Click &ldquo;+ Add New Group&rdquo; to add customized choices.
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                    {addOnGroups.map((grp, gIdx) => (
                      <div
                        key={grp.id}
                        style={{
                          background: '#ffffff',
                          padding: 14,
                          borderRadius: 10,
                          border: '1px solid #cbd5e1',
                        }}
                      >
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto 36px', gap: 10, alignItems: 'center', marginBottom: 12 }}>
                          <input
                            className="nabin-input"
                            placeholder="Group Title (e.g. Choice of Bread, Toppings)"
                            value={grp.name}
                            onChange={(e) => updateGroup(gIdx, { name: e.target.value })}
                            style={{ minHeight: 36, fontWeight: 700 }}
                            required
                          />
                          <select
                            className="nabin-select"
                            value={grp.selectionType}
                            onChange={(e) => updateGroup(gIdx, { selectionType: e.target.value as any })}
                            style={{ minHeight: 36, fontSize: 12 }}
                          >
                            <option value="single">Single Select (Radio)</option>
                            <option value="multi">Multi Select (Checkbox)</option>
                          </select>
                          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer' }}>
                            <input
                              type="checkbox"
                              checked={grp.isRequired}
                              onChange={(e) => updateGroup(gIdx, { isRequired: e.target.checked })}
                            />
                            <span>Required</span>
                          </label>
                          <button
                            type="button"
                            onClick={() => removeGroup(gIdx)}
                            style={{
                              border: 'none',
                              background: 'transparent',
                              color: 'var(--danger)',
                              cursor: 'pointer',
                              fontSize: 14,
                            }}
                            title="Delete Group"
                          >
                            ✕
                          </button>
                        </div>

                        {/* Options in this group */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingLeft: 12, borderLeft: '2px solid var(--brand-tint)' }}>
                          {grp.options.map((opt, oIdx) => (
                            <div
                              key={opt.id}
                              style={{
                                display: 'grid',
                                gridTemplateColumns: '1fr 120px auto 30px',
                                gap: 10,
                                alignItems: 'center',
                              }}
                            >
                              <input
                                className="nabin-input"
                                placeholder="Option name (e.g. Butter Naan, Extra Gravy)"
                                value={opt.name}
                                onChange={(e) => updateOption(gIdx, oIdx, { name: e.target.value })}
                                style={{ minHeight: 32, fontSize: 12 }}
                                required
                              />
                              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                <span style={{ fontSize: 12, color: 'var(--ink-muted)' }}>+₹</span>
                                <input
                                  className="nabin-input"
                                  type="number"
                                  min="0"
                                  value={opt.price}
                                  onChange={(e) => updateOption(gIdx, oIdx, { price: Number(e.target.value) || 0 })}
                                  style={{ minHeight: 32, fontSize: 12 }}
                                  required
                                />
                              </div>
                              <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, cursor: 'pointer' }}>
                                <input
                                  type="checkbox"
                                  checked={opt.isDefault}
                                  onChange={(e) => updateOption(gIdx, oIdx, { isDefault: e.target.checked })}
                                />
                                <span>Default</span>
                              </label>
                              <button
                                type="button"
                                onClick={() => removeOption(gIdx, oIdx)}
                                style={{
                                  border: 'none',
                                  background: 'transparent',
                                  color: 'var(--ink-muted)',
                                  cursor: 'pointer',
                                  fontSize: 12,
                                }}
                                title="Remove Option"
                              >
                                ✕
                              </button>
                            </div>
                          ))}

                          <button
                            type="button"
                            onClick={() => addOptionToGroup(gIdx)}
                            style={{
                              alignSelf: 'flex-start',
                              border: 'none',
                              background: 'transparent',
                              color: 'var(--brand)',
                              fontSize: 12,
                              fontWeight: 700,
                              cursor: 'pointer',
                              padding: '4px 0',
                            }}
                          >
                            + Add Option Item
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>

            {/* Footer Buttons */}
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
                  {isEditing ? 'Save Changes' : 'Create & Save Dish'}
                </button>
              </div>
            </div>
          </form>
        </div>
      </div>

      {/* Customer Experience Preview Modal */}
      {showCustomerPreview && (
        <DishPreviewModal
          dish={currentDishSnapshot}
          onClose={() => setShowCustomerPreview(false)}
        />
      )}
    </>
  );
}
