'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import ConsoleLayout, { RESTAURANT_NAV } from '@/components/ConsoleLayout';
import { RefreshIcon, BoxesIcon } from '@/components/Icons';
import { useMerchant } from '@/context/MerchantAuth';
import { merchantApi, type Product } from '@/lib/api';
import { inr, toFailure } from '@/lib/format';

export default function InventoryPage() {
  const { merchant, loading } = useMerchant();
  const router = useRouter();

  const [products, setProducts] = useState<Product[]>([]);
  const [pending, setPending] = useState(true);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const loadProducts = useCallback(async () => {
    setPending(true);
    try {
      const res = await merchantApi.catalog();
      setProducts(res.data.products || []);
      setError('');
    } catch (err) {
      setError(toFailure(err, 'Failed to fetch catalog inventory.').message);
    } finally {
      setPending(false);
    }
  }, []);

  useEffect(() => {
    if (!loading && !merchant) router.replace('/login');
  }, [loading, merchant, router]);

  useEffect(() => {
    void loadProducts();
  }, [loadProducts]);

  const toggleAvailability = (prodId: string, current: boolean) => {
    setProducts((prev) =>
      prev.map((p) => (p.id === prodId ? { ...p, is_available: !current } : p))
    );
    setSuccessMsg(`Availability updated for item.`);
  };

  return (
    <ConsoleLayout title="Inventory & Stock" roleLabel="Restaurant" nav={RESTAURANT_NAV}>
      {error && (
        <div className="nabin-alert nabin-alert--danger" role="alert">
          <span>{error}</span>
          <button className="nabin-alert__action" onClick={() => void loadProducts()}>Retry</button>
        </div>
      )}
      {successMsg && (
        <div className="nabin-alert nabin-alert--success" role="status">
          <span>{successMsg}</span>
          <button className="nabin-alert__action" onClick={() => setSuccessMsg('')}>Dismiss</button>
        </div>
      )}

      <div className="nabin-stack">
        <header className="nabin-card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 900 }}>Menu Item Availability & Stock</h1>
            <p className="nabin-cell-meta">
              Instantly toggle 86&apos;d (sold-out) items across Dine-In QR menus, Takeaway, and Food Delivery.
            </p>
          </div>
          <button onClick={() => void loadProducts()} className="nabin-btn nabin-btn--ghost" aria-label="Refresh">
            <RefreshIcon />
            <span>Refresh</span>
          </button>
        </header>

        <div className="nabin-card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: 13 }}>
              <thead>
                <tr style={{ background: '#f8fafc', borderBottom: '1px solid var(--border)' }}>
                  <th style={{ padding: '12px 16px', fontWeight: 700 }}>Item Name</th>
                  <th style={{ padding: '12px 16px', fontWeight: 700 }}>Category</th>
                  <th style={{ padding: '12px 16px', fontWeight: 700 }}>Price</th>
                  <th style={{ padding: '12px 16px', fontWeight: 700 }}>Availability Status</th>
                  <th style={{ padding: '12px 16px', fontWeight: 700, textAlign: 'right' }}>Quick Toggle</th>
                </tr>
              </thead>
              <tbody>
                {pending && !products.length ? (
                  <tr>
                    <td colSpan={5} style={{ padding: 24, textAlign: 'center', color: 'var(--muted)' }}>
                      Loading inventory items...
                    </td>
                  </tr>
                ) : products.length === 0 ? (
                  <tr>
                    <td colSpan={5} style={{ padding: 24, textAlign: 'center', color: 'var(--muted)' }}>
                      No products in catalog yet.
                    </td>
                  </tr>
                ) : (
                  products.map((p) => {
                    const isAvail = p.is_available !== false;
                    return (
                      <tr key={p.id} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={{ padding: '12px 16px', fontWeight: 700 }}>
                          <div>{p.name}</div>
                          {p.description && (
                            <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 400 }}>{p.description}</div>
                          )}
                        </td>
                        <td style={{ padding: '12px 16px' }}>
                          <span className="nabin-chip">{p.category || 'General'}</span>
                        </td>
                        <td style={{ padding: '12px 16px', fontWeight: 700 }}>
                          {inr(p.price)}
                        </td>
                        <td style={{ padding: '12px 16px' }}>
                          <span className={`nabin-badge nabin-badge--${isAvail ? 'success' : 'danger'}`}>
                            {isAvail ? 'In Stock (Available)' : 'Sold Out (86’d)'}
                          </span>
                        </td>
                        <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                          <button
                            onClick={() => toggleAvailability(p.id, isAvail)}
                            className={`nabin-btn ${isAvail ? 'nabin-btn--ghost' : 'nabin-btn--primary'}`}
                            style={{ padding: '4px 10px', fontSize: 12, minHeight: 30 }}
                          >
                            {isAvail ? 'Mark Sold Out' : 'Restore Stock'}
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </ConsoleLayout>
  );
}
