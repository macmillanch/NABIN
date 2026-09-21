'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import ConsoleLayout, { GROCERY_NAV } from '@/components/ConsoleLayout';
import { BoxesIcon, RefreshIcon } from '@/components/Icons';
import { useMerchant } from '@/context/MerchantAuth';
import { merchantApi, type InventoryItem, type MasterProduct } from '@/lib/api';
import { dateTime, inr, toFailure } from '@/lib/format';
import { humanise } from '@/lib/orderFlow';

const STATUS_TONE: Record<string, string> = {
  AVAILABLE: 'nabin-badge--success',
  LOW_STOCK: 'nabin-badge--warning',
  OUT_OF_STOCK: 'nabin-badge--danger',
  INACTIVE: 'nabin-badge--neutral',
};

interface Draft {
  currentPrice: string;
  stockQty: string;
}

export default function InventoryPage() {
  const { merchant, loading } = useMerchant();
  const router = useRouter();
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [master, setMaster] = useState<MasterProduct[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [query, setQuery] = useState('');
  const [pending, setPending] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busyId, setBusyId] = useState('');
  const [newItemId, setNewItemId] = useState('');
  const [newItem, setNewItem] = useState<Draft>({ currentPrice: '', stockQty: '' });

  const load = useCallback(async () => {
    if (!merchant?.id) return;
    setPending(true);
    try {
      const [inv, catalog] = await Promise.all([
        merchantApi.inventory(),
        merchantApi.masterCatalog().catch(() => ({ data: { products: [] } })),
      ]);
      const rows: InventoryItem[] = inv.data.inventory ?? [];
      setItems(rows);
      setMaster(catalog.data.products ?? []);
      setDrafts(
        Object.fromEntries(
          rows.map((row) => [
            row.masterProductId,
            { currentPrice: String(row.currentPrice), stockQty: String(row.stockQty) },
          ]),
        ),
      );
      setError('');
    } catch (err) {
      setError(toFailure(err, 'Could not load your inventory.').message);
    } finally {
      setPending(false);
    }
  }, [merchant?.id]);

  useEffect(() => {
    if (!loading && !merchant) router.replace('/login');
  }, [loading, merchant, router]);

  useEffect(() => {
    load();
  }, [load]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((item) =>
      `${item.masterName} ${item.brand} ${item.category}`.toLowerCase().includes(needle),
    );
  }, [items, query]);

  const stocked = useMemo(() => new Set(items.map((item) => item.masterProductId)), [items]);
  const availableToStock = useMemo(
    () => master.filter((product) => !stocked.has(product.id)),
    [master, stocked],
  );

  const save = async (masterProductId: string, payload: Draft, label: string) => {
    setBusyId(masterProductId);
    setError('');
    setNotice('');
    try {
      await merchantApi.saveInventory({
        masterProductId,
        currentPrice: Number(payload.currentPrice),
        stockQty: Number(payload.stockQty),
      });
      setNotice(`${label} updated in PostgreSQL. The customer app sees the new price on its next load.`);
      await load();
    } catch (err) {
      setError(toFailure(err, 'That change was refused by the server.').message);
    } finally {
      setBusyId('');
    }
  };

  const toggleAvailable = async (item: InventoryItem) => {
    setBusyId(item.masterProductId);
    setError('');
    try {
      await merchantApi.saveInventory({
        masterProductId: item.masterProductId,
        isAvailable: !item.isAvailable,
      });
      setNotice(`${item.masterName} is now ${item.isAvailable ? 'hidden' : 'listed'} for customers.`);
      await load();
    } catch (err) {
      setError(toFailure(err, 'Could not change that item’s availability.').message);
    } finally {
      setBusyId('');
    }
  };

  if (loading || !merchant) {
    return <div className="nabin-skeleton" style={{ minHeight: '100vh', border: 'none' }} />;
  }

  return (
    <ConsoleLayout title="Inventory" roleLabel="Grocery" nav={GROCERY_NAV}>
      <div className="nabin-stack">
        <div className="nabin-page-head" style={{ marginBottom: 0 }}>
          <div>
            <h1>Inventory</h1>
            <p>
              {items.length} stocked SKUs in this store&rsquo;s PostgreSQL inventory rows. Prices you
              save here are what the order engine re-validates against at checkout.
            </p>
          </div>
          <button onClick={load} className="nabin-btn nabin-btn--ghost" style={{ minHeight: 40 }}>
            <RefreshIcon />
            <span>Reload</span>
          </button>
        </div>

        {error && (
          <div className="nabin-alert nabin-alert--danger" role="alert">
            <span>{error}</span>
          </div>
        )}
        {notice && (
          <div className="nabin-alert nabin-alert--success" role="status">
            <span>{notice}</span>
          </div>
        )}

        <section className="nabin-card">
          <div className="nabin-card__header">
            <h2 style={{ fontSize: 17, fontWeight: 800 }}>Add a master catalogue product</h2>
            <span className="nabin-chip">{availableToStock.length} not yet stocked</span>
          </div>
          <div className="nabin-grid" style={{ alignItems: 'end' }}>
            <div>
              <label className="nabin-label" htmlFor="new-item">
                Product
              </label>
              <select
                id="new-item"
                className="nabin-input"
                value={newItemId}
                onChange={(e) => setNewItemId(e.target.value)}
              >
                <option value="">Choose a product…</option>
                {availableToStock.map((product) => (
                  <option key={product.id} value={product.id}>
                    {[product.name, product.brand, product.pack_size].filter(Boolean).join(' · ')} (
                    {product.standard_unit})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="nabin-label" htmlFor="new-price">
                Your price (₹)
              </label>
              <input
                id="new-price"
                className="nabin-input"
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                value={newItem.currentPrice}
                onChange={(e) => setNewItem((prev) => ({ ...prev, currentPrice: e.target.value }))}
              />
            </div>
            <div>
              <label className="nabin-label" htmlFor="new-stock">
                Stock quantity
              </label>
              <input
                id="new-stock"
                className="nabin-input"
                type="number"
                min="0"
                step="1"
                inputMode="numeric"
                value={newItem.stockQty}
                onChange={(e) => setNewItem((prev) => ({ ...prev, stockQty: e.target.value }))}
              />
            </div>
            <button
              onClick={() => {
                if (!newItemId || !newItem.currentPrice || !newItem.stockQty) {
                  setError('Pick a product and enter both a price and a stock quantity.');
                  return;
                }
                const label = master.find((product) => product.id === newItemId)?.name ?? 'Product';
                save(newItemId, newItem, label).then(() => {
                  setNewItemId('');
                  setNewItem({ currentPrice: '', stockQty: '' });
                });
              }}
              className="nabin-btn nabin-btn--primary"
              disabled={Boolean(busyId)}
            >
              {busyId && busyId === newItemId ? 'Saving…' : 'Stock it'}
            </button>
          </div>
        </section>

        <div>
          <label className="nabin-label" htmlFor="inv-search">
            Search your store
          </label>
          <input
            id="inv-search"
            className="nabin-input"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Product, brand or category"
          />
        </div>

        {pending && !items.length ? (
          <>
            <div className="nabin-skeleton" style={{ height: 72 }} />
            <div className="nabin-skeleton" style={{ height: 72 }} />
          </>
        ) : !visible.length ? (
          <div className="nabin-card nabin-empty">
            <BoxesIcon size={28} />
            <p className="nabin-empty__title">
              {items.length ? 'Nothing matches that search' : 'This store has no stocked SKUs yet'}
            </p>
            <p>
              {items.length
                ? 'Try a shorter search term.'
                : 'Add one from the NABIN master catalogue above to start selling.'}
            </p>
          </div>
        ) : (
          visible.map((item) => {
            const draft = drafts[item.masterProductId] ?? { currentPrice: '', stockQty: '' };
            const dirty =
              draft.currentPrice !== String(item.currentPrice) ||
              draft.stockQty !== String(item.stockQty);
            return (
              <section key={item.inventoryId} className="nabin-card">
                <div className="nabin-card__header">
                  <div className="nabin-cell-stack">
                    <span className="nabin-cell-title" style={{ fontSize: 17 }}>
                      {item.masterName}
                    </span>
                    <span className="nabin-cell-meta">
                      {item.brand} · {item.category} · {item.packSize} · priced per {item.unit} ·{' '}
                      {humanise(item.pricingModel)}
                    </span>
                  </div>
                  <div className="nabin-row">
                    <span className={`nabin-badge ${STATUS_TONE[item.status] ?? 'nabin-badge--neutral'}`}>
                      {humanise(item.status)}
                    </span>
                    <span className={`nabin-badge ${item.isAvailable ? 'nabin-badge--success' : 'nabin-badge--neutral'}`}>
                      {item.isAvailable ? 'Listed' : 'Hidden'}
                    </span>
                  </div>
                </div>

                <div className="nabin-grid" style={{ alignItems: 'end' }}>
                  <div>
                    <label className="nabin-label" htmlFor={`price-${item.inventoryId}`}>
                      Price (₹)
                    </label>
                    <input
                      id={`price-${item.inventoryId}`}
                      className="nabin-input"
                      type="number"
                      min="0"
                      step="0.01"
                      inputMode="decimal"
                      value={draft.currentPrice}
                      onChange={(e) =>
                        setDrafts((prev) => ({
                          ...prev,
                          [item.masterProductId]: { ...draft, currentPrice: e.target.value },
                        }))
                      }
                    />
                  </div>
                  <div>
                    <label className="nabin-label" htmlFor={`stock-${item.inventoryId}`}>
                      Stock quantity
                    </label>
                    <input
                      id={`stock-${item.inventoryId}`}
                      className="nabin-input"
                      type="number"
                      min="0"
                      step="1"
                      inputMode="numeric"
                      value={draft.stockQty}
                      onChange={(e) =>
                        setDrafts((prev) => ({
                          ...prev,
                          [item.masterProductId]: { ...draft, stockQty: e.target.value },
                        }))
                      }
                    />
                  </div>
                  <div className="nabin-row" style={{ flexWrap: 'wrap' }}>
                    <button
                      onClick={() => save(item.masterProductId, draft, item.masterName)}
                      className="nabin-btn nabin-btn--primary"
                      disabled={Boolean(busyId) || !dirty}
                    >
                      {busyId === item.masterProductId ? 'Saving…' : 'Save changes'}
                    </button>
                    <button
                      onClick={() =>
                        setDrafts((prev) => ({
                          ...prev,
                          [item.masterProductId]: {
                            currentPrice: String(item.currentPrice),
                            stockQty: String(item.stockQty),
                          },
                        }))
                      }
                      className="nabin-btn nabin-btn--ghost"
                      disabled={!dirty}
                    >
                      Reset
                    </button>
                    <button
                      onClick={() => toggleAvailable(item)}
                      className="nabin-btn nabin-btn--ghost"
                      disabled={Boolean(busyId)}
                    >
                      {item.isAvailable ? 'Hide from customers' : 'List to customers'}
                    </button>
                  </div>
                </div>

                <p className="nabin-cell-meta" style={{ marginTop: 'var(--space-md)' }}>
                  Currently {inr(item.currentPrice)} · {item.stockQty} {item.unit} on file · last
                  changed {dateTime(item.updatedAt)}
                </p>
              </section>
            );
          })
        )}
      </div>
    </ConsoleLayout>
  );
}
