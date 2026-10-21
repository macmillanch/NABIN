'use client';

import { useMemo, useState } from 'react';
import type { GroceryProductItem, GroceryProductVariant } from '@/lib/catalogData';
import { inr } from '@/lib/format';

export interface CustomizedGroceryCartItem {
  productId: string;
  name: string;
  brand: string;
  variantName?: string;
  packSize?: string;
  unit: string;
  unitPrice: number;
  quantity: number;
}

interface Props {
  product: GroceryProductItem | null;
  onAddToCart: (item: CustomizedGroceryCartItem) => void;
  onClose: () => void;
}

export default function CustomerGroceryCustomizer({ product, onAddToCart, onClose }: Props) {
  const [selectedVariantId, setSelectedVariantId] = useState<string>(() => {
    return product?.variants?.[0]?.id ?? '';
  });
  const [quantity, setQuantity] = useState(1);

  if (!product) return null;

  const currentVariant: GroceryProductVariant | undefined = useMemo(() => {
    return product.variants.find((v) => v.id === selectedVariantId) ?? product.variants[0];
  }, [product.variants, selectedVariantId]);

  const activePrice = currentVariant ? currentVariant.sellingPrice : product.sellingPrice;
  const activeMrp = currentVariant?.mrp ?? product.mrp;
  const activeStock = currentVariant ? currentVariant.stockQty : product.stockQty;
  const isOutOfStock = activeStock <= 0 || !product.isAvailable;
  const isLowStock = activeStock > 0 && activeStock <= product.lowStockThreshold;

  const discountPercent =
    activeMrp && activeMrp > activePrice
      ? Math.round(((activeMrp - activePrice) / activeMrp) * 100)
      : product.discountPercent;

  const grandTotal = activePrice * quantity;

  const handleAdd = () => {
    if (isOutOfStock) return;
    onAddToCart({
      productId: product.id,
      name: product.name,
      brand: product.brand,
      variantName: currentVariant?.name,
      packSize: currentVariant ? currentVariant.packSize : product.unit,
      unit: product.unit,
      unitPrice: activePrice,
      quantity,
    });
    onClose();
  };

  const primaryPhoto = product.photos[product.primaryPhotoIndex] || product.photos[0] || '';

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
              Select Product Pack
            </h2>
            <p style={{ fontSize: 11, margin: 0, color: 'rgba(255, 255, 255, 0.8)' }}>
              Choose your weight or pack size
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
          <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', marginBottom: 20 }}>
            {primaryPhoto ? (
              <div
                style={{
                  width: 110,
                  height: 110,
                  borderRadius: 12,
                  overflow: 'hidden',
                  flexShrink: 0,
                  border: '1px solid #e2e8f0',
                }}
              >
                <img
                  src={primaryPhoto}
                  alt={product.name}
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                />
              </div>
            ) : (
              <div
                style={{
                  width: 110,
                  height: 110,
                  borderRadius: 12,
                  background: '#f1f5f9',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 36,
                  flexShrink: 0,
                }}
              >
                📦
              </div>
            )}

            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <span className="nabin-badge nabin-badge--primary" style={{ fontSize: 10 }}>
                  {product.brand}
                </span>
                <span className="nabin-cell-meta" style={{ fontSize: 11 }}>
                  {product.category}
                </span>
                {isOutOfStock ? (
                  <span className="nabin-badge nabin-badge--danger" style={{ fontSize: 10 }}>
                    Sold Out
                  </span>
                ) : isLowStock ? (
                  <span className="nabin-badge nabin-badge--warning" style={{ fontSize: 10 }}>
                    Only {activeStock} left
                  </span>
                ) : (
                  <span className="nabin-badge nabin-badge--success" style={{ fontSize: 10 }}>
                    In Stock
                  </span>
                )}
              </div>

              <h3 style={{ fontSize: 17, fontWeight: 800, margin: '2px 0 6px', color: 'var(--ink)' }}>
                {product.name}
              </h3>
              <p style={{ fontSize: 12, color: 'var(--ink-muted)', margin: 0, lineHeight: 1.4 }}>
                {product.description}
              </p>

              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 8 }}>
                <span style={{ fontSize: 20, fontWeight: 800, color: 'var(--brand)' }}>
                  {inr(activePrice)}
                </span>
                <span style={{ fontSize: 12, color: 'var(--ink-muted)' }}>
                  / {currentVariant ? currentVariant.packSize : product.unit}
                </span>
                {activeMrp && activeMrp > activePrice && (
                  <s style={{ fontSize: 12, color: 'var(--ink-muted)' }}>{inr(activeMrp)}</s>
                )}
                {discountPercent && discountPercent > 0 && (
                  <span className="nabin-badge nabin-badge--success" style={{ fontSize: 10 }}>
                    {discountPercent}% OFF
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Variants */}
          {product.variants.length > 0 && (
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
                <strong style={{ fontSize: 13, color: 'var(--ink)' }}>Choose Pack Size / Weight</strong>
                <span style={{ fontSize: 11, color: 'var(--ink-muted)' }}>Sold by {product.unit}</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {product.variants.map((v) => {
                  const isSelected = (currentVariant?.id ?? '') === v.id;
                  const vStock = v.stockQty;
                  const isVOut = vStock <= 0 || !v.isAvailable;
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
                        cursor: isVOut ? 'not-allowed' : 'pointer',
                        opacity: isVOut ? 0.6 : 1,
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <input
                          type="radio"
                          name="cust_grocery_variant"
                          checked={isSelected}
                          disabled={isVOut}
                          onChange={() => {
                            setSelectedVariantId(v.id);
                            setQuantity(1);
                          }}
                          style={{ accentColor: 'var(--brand)' }}
                        />
                        <div>
                          <span style={{ fontSize: 13, fontWeight: isSelected ? 700 : 500 }}>
                            {v.name} ({v.packSize})
                          </span>
                          {isVOut ? (
                            <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--danger)', fontWeight: 700 }}>
                              Sold Out
                            </span>
                          ) : (
                            <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--ink-muted)' }}>
                              Stock: {vStock}
                            </span>
                          )}
                        </div>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                        <span style={{ fontSize: 14, fontWeight: 800, color: 'var(--ink)' }}>
                          {inr(v.sellingPrice)}
                        </span>
                        {v.mrp > v.sellingPrice && (
                          <s style={{ fontSize: 11, color: 'var(--ink-muted)' }}>{inr(v.mrp)}</s>
                        )}
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>
          )}
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
          {/* Stepper */}
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
              disabled={quantity <= 1 || isOutOfStock}
              style={{
                width: 36,
                height: 36,
                border: 'none',
                background: 'transparent',
                cursor: quantity <= 1 || isOutOfStock ? 'not-allowed' : 'pointer',
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
              onClick={() => setQuantity((q) => Math.min(activeStock || 10, q + 1))}
              disabled={isOutOfStock || quantity >= activeStock}
              style={{
                width: 36,
                height: 36,
                border: 'none',
                background: 'transparent',
                cursor: isOutOfStock || quantity >= activeStock ? 'not-allowed' : 'pointer',
                fontSize: 16,
                fontWeight: 700,
                color: 'var(--ink)',
              }}
            >
              +
            </button>
          </div>

          <button
            type="button"
            onClick={handleAdd}
            disabled={isOutOfStock}
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
              opacity: isOutOfStock ? 0.5 : 1,
            }}
          >
            <span>{isOutOfStock ? 'Item Out of Stock' : `Add to Cart (${quantity})`}</span>
            <span>{inr(grandTotal)}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
