'use client';

import { useMemo, useState } from 'react';
import type { DishAddOnGroup, DishVariant, RestaurantDishItem } from '@/lib/catalogData';
import { inr } from '@/lib/format';

export interface CustomizedCartItem {
  productId: string;
  name: string;
  variantName?: string;
  addOnNames?: string[];
  unitPrice: number;
  quantity: number;
}

interface Props {
  dish: RestaurantDishItem | null;
  onAddToCart: (item: CustomizedCartItem) => void;
  onClose: () => void;
}

export default function CustomerDishCustomizer({ dish, onAddToCart, onClose }: Props) {
  const [selectedVariantId, setSelectedVariantId] = useState<string>(() => {
    return dish?.variants?.[0]?.id ?? '';
  });

  const [selectedAddOns, setSelectedAddOns] = useState<Record<string, string[]>>(() => {
    if (!dish) return {};
    const init: Record<string, string[]> = {};
    dish.addOnGroups.forEach((grp) => {
      const defaults = grp.options.filter((o) => o.isDefault).map((o) => o.id);
      if (defaults.length > 0) {
        init[grp.id] = defaults;
      } else if (grp.isRequired && grp.options.length > 0) {
        init[grp.id] = [grp.options[0].id];
      } else {
        init[grp.id] = [];
      }
    });
    return init;
  });

  const [quantity, setQuantity] = useState(1);
  const [validationError, setValidationError] = useState('');

  if (!dish) return null;

  const currentVariant: DishVariant | undefined = useMemo(() => {
    return dish.variants.find((v) => v.id === selectedVariantId) ?? dish.variants[0];
  }, [dish.variants, selectedVariantId]);

  const basePrice = currentVariant ? currentVariant.price : dish.sellingPrice || dish.basePrice;

  const addOnsTotal = useMemo(() => {
    let sum = 0;
    dish.addOnGroups.forEach((grp) => {
      const chosen = selectedAddOns[grp.id] ?? [];
      grp.options.forEach((opt) => {
        if (chosen.includes(opt.id)) {
          sum += opt.price;
        }
      });
    });
    return sum;
  }, [dish.addOnGroups, selectedAddOns]);

  const unitTotal = basePrice + addOnsTotal;
  const grandTotal = unitTotal * quantity;

  const toggleOption = (grp: DishAddOnGroup, optId: string) => {
    setValidationError('');
    const current = selectedAddOns[grp.id] ?? [];
    if (grp.selectionType === 'single') {
      setSelectedAddOns({ ...selectedAddOns, [grp.id]: [optId] });
    } else {
      let next: string[];
      if (current.includes(optId)) {
        next = current.filter((id) => id !== optId);
      } else {
        if (grp.maxSelect && current.length >= grp.maxSelect) {
          return;
        }
        next = [...current, optId];
      }
      setSelectedAddOns({ ...selectedAddOns, [grp.id]: next });
    }
  };

  const handleAdd = () => {
    // Validate required groups
    for (const grp of dish.addOnGroups) {
      if (grp.isRequired) {
        const chosen = selectedAddOns[grp.id] ?? [];
        if (chosen.length < (grp.minSelect || 1)) {
          setValidationError(`Please select required option for "${grp.name}".`);
          return;
        }
      }
    }

    const addOnNamesList: string[] = [];
    dish.addOnGroups.forEach((grp) => {
      const chosen = selectedAddOns[grp.id] ?? [];
      grp.options.forEach((opt) => {
        if (chosen.includes(opt.id)) {
          addOnNamesList.push(opt.name);
        }
      });
    });

    onAddToCart({
      productId: dish.id,
      name: dish.name,
      variantName: currentVariant?.name,
      addOnNames: addOnNamesList.length > 0 ? addOnNamesList : undefined,
      unitPrice: unitTotal,
      quantity,
    });
    onClose();
  };

  const primaryPhoto = dish.photos[dish.primaryPhotoIndex] || dish.photos[0] || '';

  return (
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
          borderRadius: 20,
          width: '100%',
          maxWidth: 580,
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
          overflow: 'hidden',
          animation: 'fadeIn 0.2s ease',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '16px 20px',
            borderBottom: '1px solid var(--divider)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'linear-gradient(135deg, #1A3BA2 0%, #0d2570 100%)',
            color: '#ffffff',
          }}
        >
          <div>
            <h2 style={{ fontSize: 16, fontWeight: 800, margin: 0, color: '#ffffff' }}>
              Customise Your Dish
            </h2>
            <p style={{ fontSize: 11, margin: 0, color: 'rgba(255, 255, 255, 0.8)' }}>
              Choose your portion size and accompaniments
            </p>
          </div>
          <button
            onClick={onClose}
            className="nabin-btn nabin-btn--ghost"
            style={{
              color: '#ffffff',
              borderColor: 'rgba(255, 255, 255, 0.2)',
              minHeight: 32,
              padding: '0 12px',
              fontSize: 12,
            }}
          >
            ✕
          </button>
        </div>

        {/* Scrollable Content */}
        <div style={{ overflowY: 'auto', padding: '20px', flex: '1 1 auto' }}>
          {/* Dish hero */}
          <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', marginBottom: 20 }}>
            {primaryPhoto ? (
              <div
                style={{
                  width: 100,
                  height: 100,
                  borderRadius: 12,
                  overflow: 'hidden',
                  flexShrink: 0,
                  border: '1px solid #e2e8f0',
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
                  width: 100,
                  height: 100,
                  borderRadius: 12,
                  background: '#f1f5f9',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 32,
                  flexShrink: 0,
                }}
              >
                🍲
              </div>
            )}

            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: 14,
                    height: 14,
                    border: `1.5px solid ${dish.foodType === 'veg' ? '#16a34a' : '#dc2626'}`,
                    borderRadius: 3,
                    padding: 1,
                  }}
                >
                  <span
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: '50%',
                      background: dish.foodType === 'veg' ? '#16a34a' : '#dc2626',
                    }}
                  />
                </span>
                <span className="nabin-badge nabin-badge--neutral" style={{ fontSize: 10 }}>
                  {dish.category}
                </span>
                <span style={{ fontSize: 11, color: 'var(--ink-muted)' }}>⏱️ {dish.prepTime} mins</span>
              </div>

              <h3 style={{ fontSize: 17, fontWeight: 800, margin: '2px 0 6px', color: 'var(--ink)' }}>
                {dish.name}
              </h3>
              <p style={{ fontSize: 12, color: 'var(--ink-muted)', margin: 0, lineHeight: 1.4 }}>
                {dish.description}
              </p>
            </div>
          </div>

          {validationError && (
            <div className="nabin-alert nabin-alert--danger" style={{ marginBottom: 14 }}>
              <span>⚠️ {validationError}</span>
            </div>
          )}

          {/* Sizing / Portion selection */}
          {dish.variants.length > 0 && (
            <div
              style={{
                marginBottom: 16,
                padding: 14,
                borderRadius: 12,
                background: '#f8fafc',
                border: '1px solid #e2e8f0',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
                <strong style={{ fontSize: 13, color: 'var(--ink)' }}>Select Portion Size</strong>
                <span className="nabin-badge nabin-badge--primary" style={{ fontSize: 10 }}>
                  Required &bull; 1 option
                </span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {dish.variants.map((v) => {
                  const isSelected = (currentVariant?.id ?? '') === v.id;
                  return (
                    <label
                      key={v.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '10px 12px',
                        borderRadius: 8,
                        background: isSelected ? '#ffffff' : 'transparent',
                        border: isSelected ? '1.5px solid var(--brand)' : '1px solid transparent',
                        cursor: 'pointer',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <input
                          type="radio"
                          name="cust_variant"
                          checked={isSelected}
                          onChange={() => setSelectedVariantId(v.id)}
                          style={{ accentColor: 'var(--brand)' }}
                        />
                        <span style={{ fontSize: 13, fontWeight: isSelected ? 700 : 500 }}>{v.name}</span>
                      </div>
                      <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--ink)' }}>
                        {inr(v.price)}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          )}

          {/* Add-on groups */}
          {dish.addOnGroups.map((grp) => {
            const currentSelected = selectedAddOns[grp.id] ?? [];
            return (
              <div
                key={grp.id}
                style={{
                  marginBottom: 16,
                  padding: 14,
                  borderRadius: 12,
                  background: '#f8fafc',
                  border: '1px solid #e2e8f0',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
                  <div>
                    <strong style={{ fontSize: 13, color: 'var(--ink)' }}>{grp.name}</strong>
                    <div style={{ fontSize: 11, color: 'var(--ink-muted)' }}>
                      {grp.selectionType === 'single'
                        ? 'Select 1 option'
                        : `Select up to ${grp.maxSelect || grp.options.length} options`}
                    </div>
                  </div>
                  <span
                    className={`nabin-badge ${grp.isRequired ? 'nabin-badge--warning' : 'nabin-badge--neutral'}`}
                    style={{ fontSize: 10 }}
                  >
                    {grp.isRequired ? 'Required' : 'Optional'}
                  </span>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {grp.options.map((opt) => {
                    const isChecked = currentSelected.includes(opt.id);
                    return (
                      <label
                        key={opt.id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '8px 12px',
                          borderRadius: 8,
                          background: isChecked ? '#ffffff' : 'transparent',
                          border: isChecked ? '1px solid var(--brand)' : '1px solid transparent',
                          cursor: 'pointer',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <input
                            type={grp.selectionType === 'single' ? 'radio' : 'checkbox'}
                            name={`cust_grp_${grp.id}`}
                            checked={isChecked}
                            onChange={() => toggleOption(grp, opt.id)}
                            style={{ accentColor: 'var(--brand)' }}
                          />
                          <span style={{ fontSize: 13, fontWeight: isChecked ? 600 : 400 }}>
                            {opt.name}
                          </span>
                        </div>
                        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>
                          +{inr(opt.price)}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: '16px 20px',
            borderTop: '1px solid var(--divider)',
            background: '#ffffff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 16,
          }}
        >
          {/* Quantity stepper */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              border: '1.5px solid var(--divider)',
              borderRadius: 10,
              overflow: 'hidden',
              background: '#f8fafc',
            }}
          >
            <button
              type="button"
              onClick={() => setQuantity((q) => Math.max(1, q - 1))}
              disabled={quantity <= 1}
              style={{
                width: 36,
                height: 36,
                border: 'none',
                background: 'transparent',
                cursor: quantity <= 1 ? 'not-allowed' : 'pointer',
                fontSize: 16,
                fontWeight: 700,
                color: 'var(--ink)',
              }}
            >
              −
            </button>
            <span
              style={{
                minWidth: 32,
                textAlign: 'center',
                fontWeight: 800,
                fontSize: 14,
                color: 'var(--ink)',
              }}
            >
              {quantity}
            </span>
            <button
              type="button"
              onClick={() => setQuantity((q) => Math.min(20, q + 1))}
              style={{
                width: 36,
                height: 36,
                border: 'none',
                background: 'transparent',
                cursor: 'pointer',
                fontSize: 16,
                fontWeight: 700,
                color: 'var(--ink)',
              }}
            >
              +
            </button>
          </div>

          {/* Add to Cart button */}
          <button
            type="button"
            onClick={handleAdd}
            className="nabin-btn nabin-btn--primary"
            style={{
              flex: 1,
              minHeight: 44,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '0 20px',
              fontSize: 14,
              fontWeight: 800,
            }}
          >
            <span>Add to Order &bull; {quantity} item{quantity > 1 ? 's' : ''}</span>
            <span>{inr(grandTotal)}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
