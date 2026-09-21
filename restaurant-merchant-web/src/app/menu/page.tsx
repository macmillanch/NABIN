'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import ConsoleLayout, { RESTAURANT_NAV } from '@/components/ConsoleLayout';
import { RefreshIcon } from '@/components/Icons';
import { useMerchant } from '@/context/MerchantAuth';
import { merchantApi, type Product } from '@/lib/api';
import { inr, toFailure } from '@/lib/format';

export default function MenuPage() {
  const { merchant, loading } = useMerchant();
  const router = useRouter();
  const [products, setProducts] = useState<Product[]>([]);
  const [query, setQuery] = useState('');
  const [pending, setPending] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!merchant?.id) return;
    try {
      const res = await merchantApi.catalog();
      setProducts(res.data.products ?? []);
      setError('');
    } catch (err) {
      setError(toFailure(err, 'Could not load your menu.').message);
    } finally {
      setPending(false);
    }
  }, [merchant?.id]);

  useEffect(() => {
    if (!loading && !merchant) router.replace('/login');
  }, [loading, merchant, router]);

  useEffect(() => {
    // Every state update in `load` lands after an `await`, so this is not the
    // cascading render the rule warns about.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const grouped = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const buckets = new Map<string, Product[]>();
    for (const product of products) {
      if (needle && !`${product.name} ${product.sku ?? ''}`.toLowerCase().includes(needle)) continue;
      const key = product.category || 'Uncategorised';
      buckets.set(key, [...(buckets.get(key) ?? []), product]);
    }
    return [...buckets.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [products, query]);

  if (loading || !merchant) {
    return <div className="nabin-skeleton" style={{ minHeight: '100vh', border: 'none' }} />;
  }

  return (
    <ConsoleLayout title="Menu" roleLabel="Restaurant" nav={RESTAURANT_NAV}>
      <div className="nabin-stack">
        <div className="nabin-page-head" style={{ marginBottom: 0 }}>
          <div>
            <h1>Menu</h1>
            <p>{products.length} dishes stored against this merchant in PostgreSQL.</p>
          </div>
          <button onClick={load} className="nabin-btn nabin-btn--ghost" style={{ minHeight: 40 }}>
            <RefreshIcon />
            <span>Reload</span>
          </button>
        </div>

        <p className="nabin-notice">
          This list is read from the database and is safe to quote to customers. Editing prices or
          sold-out flags is not wired to a persistent endpoint yet — the existing menu toggle only
          changes the backend&rsquo;s in-memory copy, so it is deliberately not exposed here.
        </p>

        {error && (
          <div className="nabin-alert nabin-alert--danger" role="alert">
            <span>{error}</span>
            <button className="nabin-alert__action" onClick={load}>
              Retry
            </button>
          </div>
        )}

        <div>
          <label className="nabin-label" htmlFor="menu-search">
            Search dishes
          </label>
          <input
            id="menu-search"
            className="nabin-input"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Name or SKU"
          />
        </div>

        {pending && !products.length ? (
          <>
            <div className="nabin-skeleton" style={{ height: 64 }} />
            <div className="nabin-skeleton" style={{ height: 64 }} />
          </>
        ) : !grouped.length ? (
          <div className="nabin-card nabin-empty">
            <p className="nabin-empty__title">
              {products.length ? 'No dish matches that search' : 'No dishes on file'}
            </p>
            <p>
              {products.length
                ? 'Try a shorter search term.'
                : 'Once this store has products in the `products` table they appear here.'}
            </p>
          </div>
        ) : (
          grouped.map(([category, items]) => (
            <section key={category} className="nabin-card">
              <div className="nabin-card__header">
                <h2 style={{ fontSize: 17, fontWeight: 800 }}>{category}</h2>
                <span className="nabin-chip">{items.length} items</span>
              </div>
              <div className="nabin-table-wrap">
                <table className="nabin-table">
                  <thead>
                    <tr>
                      <th>Dish</th>
                      <th className="nabin-hide-sm">SKU</th>
                      <th className="nabin--end">Price</th>
                      <th className="nabin--end">Availability</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((product) => (
                      <tr key={product.id}>
                        <td>
                          <div className="nabin-cell-stack">
                            <span className="nabin-cell-title">{product.name}</span>
                            {product.description && (
                              <span className="nabin-cell-meta">{product.description}</span>
                            )}
                          </div>
                        </td>
                        <td className="nabin-hide-sm">
                          <span className="nabin-mono">{product.sku ?? '—'}</span>
                        </td>
                        <td className="nabin--end nabin-num">
                          {product.discount_price ? (
                            <div className="nabin-cell-stack">
                              <span>{inr(product.discount_price)}</span>
                              <span className="nabin-cell-meta" style={{ textDecoration: 'line-through' }}>
                                {inr(product.price)}
                              </span>
                            </div>
                          ) : (
                            inr(product.price)
                          )}
                        </td>
                        <td className="nabin--end">
                          <span
                            className={`nabin-badge ${product.is_available ? 'nabin-badge--success' : 'nabin-badge--neutral'}`}
                          >
                            {product.is_available ? 'Available' : 'Hidden'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ))
        )}
      </div>
    </ConsoleLayout>
  );
}
