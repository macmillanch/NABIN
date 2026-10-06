"use client";

/* eslint-disable react-hooks/set-state-in-effect */

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import AppShell from "@/components/AppShell";
import FlowPage from "@/components/FlowPage";
import useSession from "@/hooks/useSession";
import { bookingApi, discoveryApi } from "@/lib/api";
import { inr, toFailure } from "@/lib/format";

/**
 * Food discovery and real menu ordering.
 *
 * Everything on this screen comes from the platform's own PostgreSQL-backed reads:
 *   GET /api/restaurants            (restaurant list, search + openNow)
 *   GET /api/restaurants/:id        (restaurant detail)
 *   GET /api/restaurants/:id/menu   (the merchant's real catalogue)
 * and the order goes through the existing server-authoritative checkout
 *   POST /api/customer/book-food    (items carry product UUIDs; prices and totals are computed
 *                                    server-side from the merchant's catalogue, never from this page)
 *
 * There is deliberately no typed restaurant ID and no typed item name. If a restaurant or dish is not in
 * the database it cannot be ordered, which is the point: a customer cannot invent an order the kitchen
 * never listed. When the store cannot be reached the server marks the payload `degraded`, and that is
 * surfaced instead of quietly rendering fixtures as real availability.
 */

interface Restaurant {
  id: string;
  name: string;
  merchantType: string | null;
  address: string | null;
  cuisines: string[];
  rating: number | null;
  deliveryTime: string | null;
  isOpen: boolean;
  location: { lat: number; lng: number } | null;
}

interface MenuItem {
  id: string;
  sku: string | null;
  name: string;
  description: string | null;
  category: string | null;
  price: number;
  sellingPrice: number;
  mrp: number | null;
  discountPercent: number | null;
  isVeg: boolean | null;
  isAvailable: boolean;
}

interface CartLine {
  productId: string;
  name: string;
  unitPrice: number;
  quantity: number;
}

interface PlacedOrder {
  id: string;
  orderNumber?: string;
  status?: string;
  totalAmount?: number;
  lines?: { product_name_snapshot?: string; quantity?: number; line_total?: number }[];
}

type Load = "idle" | "loading" | "ready" | "error";

export default function FoodPage() {
  const { user, loading: sessionLoading } = useSession();

  // --- discovery list ---
  const [searchDraft, setSearchDraft] = useState("");
  const [search, setSearch] = useState("");
  const [openOnly, setOpenOnly] = useState(false);
  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [listState, setListState] = useState<Load>("loading");
  const [listError, setListError] = useState("");
  const [listDegraded, setListDegraded] = useState(false);

  // --- selected restaurant + menu ---
  const [active, setActive] = useState<Restaurant | null>(null);
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [menuState, setMenuState] = useState<Load>("idle");
  const [menuError, setMenuError] = useState("");
  const [menuDegraded, setMenuDegraded] = useState(false);
  const [category, setCategory] = useState("ALL");

  // --- cart + checkout ---
  const [cart, setCart] = useState<CartLine[]>([]);
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  const [order, setOrder] = useState<PlacedOrder | null>(null);
  // One key per cart: if a submit times out and the customer retries, the server dedupes instead of
  // placing the same order twice. It is replaced only once an order has actually landed.
  const idemRef = useRef<string>(`idemp_food_web_${crypto.randomUUID()}`);

  const loadRestaurants = useCallback(async () => {
    setListState("loading");
    setListError("");
    try {
      const res = await discoveryApi.restaurants({
        search: search || undefined,
        openNow: openOnly || undefined,
      });
      setRestaurants(res.data.restaurants ?? []);
      setListDegraded(res.data.dataSource !== "postgres");
      setListState("ready");
    } catch (err) {
      setListError(toFailure(err, "Could not load nearby restaurants.").message);
      setListState("error");
    }
  }, [search, openOnly]);

  useEffect(() => {
    void loadRestaurants();
  }, [loadRestaurants]);

  const openRestaurant = async (restaurant: Restaurant) => {
    setActive(restaurant);
    setOrder(null);
    setFailure("");
    setMenuState("loading");
    setMenuError("");
    setCategory("ALL");
    try {
      const res = await discoveryApi.menu(restaurant.id);
      setMenu(res.data.items ?? []);
      setMenuDegraded(res.data.dataSource !== "postgres");
      setMenuState("ready");
    } catch (err) {
      setMenuError(toFailure(err, "Could not load this menu.").message);
      setMenuState("error");
    }
  };

  const closeRestaurant = () => {
    setActive(null);
    setMenu([]);
    setCart([]);
    setMenuState("idle");
    setOrder(null);
    setFailure("");
    idemRef.current = `idemp_food_web_${crypto.randomUUID()}`;
  };

  const setQty = (item: MenuItem, quantity: number) => {
    const qty = Math.max(0, Math.min(99, Math.trunc(quantity)));
    setCart((prev) => {
      const others = prev.filter((line) => line.productId !== item.id);
      if (qty === 0) return others;
      const existing = prev.find((line) => line.productId === item.id);
      const line: CartLine = {
        productId: item.id,
        name: item.name,
        // The menu's server price is used only for the running estimate. Checkout recomputes every line
        // from the merchant catalogue, so a stale tab cannot dictate what the customer pays.
        unitPrice: item.sellingPrice,
        quantity: qty,
      };
      return existing ? [...others, line] : [...prev, line];
    });
  };

  const qtyInCart = (productId: string) => cart.find((l) => l.productId === productId)?.quantity ?? 0;

  const categories = Array.from(new Set(menu.map((m) => m.category).filter((c): c is string => !!c)));
  const visibleMenu = category === "ALL" ? menu : menu.filter((m) => m.category === category);
  const cartCount = cart.reduce((n, l) => n + l.quantity, 0);
  const estimate = Math.round(cart.reduce((n, l) => n + l.unitPrice * l.quantity, 0) * 100) / 100;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!active) {
      setFailure("Choose a restaurant first.");
      return;
    }
    if (!deliveryAddress.trim()) {
      setFailure("Enter a delivery address.");
      return;
    }
    if (cart.length === 0) {
      setFailure("Add at least one dish from the menu.");
      return;
    }

    setBusy(true);
    setFailure("");
    setOrder(null);
    try {
      const res = await bookingApi.bookFood({
        // No customerId: the session is the authority and the route rejects a mismatching one.
        restaurantId: active.id,
        deliveryAddress: deliveryAddress.trim(),
        items: cart.map((line) => ({ productId: line.productId, quantity: line.quantity })),
        idempotencyKey: idemRef.current,
      });
      if (res.data.success) {
        setOrder(res.data.job);
        setCart([]);
        setMenu([]);
        void openMenuRefresh(active);
        idemRef.current = `idemp_food_web_${crypto.randomUUID()}`;
      } else {
        setFailure(res.data.error || "Could not place the order.");
      }
    } catch (err) {
      setFailure(toFailure(err, "Could not reach the NABIN API.").message);
    } finally {
      setBusy(false);
    }
  };

  // After an order the stock/availability shown on the menu is by definition stale.
  const openMenuRefresh = async (restaurant: Restaurant) => {
    try {
      const res = await discoveryApi.menu(restaurant.id);
      setMenu(res.data.items ?? []);
      setMenuDegraded(res.data.dataSource !== "postgres");
    } catch {
      setMenu([]);
      setMenuState("error");
      setMenuError("The order was placed, but the menu could not be reloaded.");
    }
  };

  if (sessionLoading || !user) {
    return (
      <AppShell>
        <div className="nabin-skeleton" style={{ height: 260, borderRadius: 20 }} />
      </AppShell>
    );
  }

  return (
    <AppShell>
      <FlowPage
        title={active ? active.name : "Order food"}
        subtitle={active ? "Pick dishes from this restaurant's live menu." : "Real restaurants, real menus, real prices."}
      >
        {!active && (
          <>
            <form
              className="nabin-card"
              style={{ display: "flex", gap: "var(--space-sm)", flexWrap: "wrap", alignItems: "flex-end" }}
              onSubmit={(e) => {
                e.preventDefault();
                setSearch(searchDraft.trim());
              }}
            >
              <div style={{ flex: "1 1 220px" }}>
                <label className="nabin-label" htmlFor="q">
                  Search restaurants
                </label>
                <input
                  id="q"
                  className="nabin-input"
                  type="search"
                  value={searchDraft}
                  onChange={(e) => setSearchDraft(e.target.value)}
                  placeholder="e.g. Spice Garden"
                />
              </div>
              <label style={{ display: "flex", alignItems: "center", gap: 8, paddingBottom: 10 }}>
                <input
                  type="checkbox"
                  checked={openOnly}
                  onChange={(e) => setOpenOnly(e.target.checked)}
                  aria-label="Open now only"
                />
                <span className="nabin-label" style={{ marginBottom: 0 }}>
                  Open now
                </span>
              </label>
              <button type="submit" className="nabin-btn" disabled={listState === "loading"}>
                Search
              </button>
              {search && (
                <button
                  type="button"
                  className="nabin-btn nabin-btn--ghost"
                  onClick={() => {
                    setSearchDraft("");
                    setSearch("");
                  }}
                >
                  Clear
                </button>
              )}
            </form>

            {listDegraded && (
              <div className="nabin-notice">
                The store could not be reached, so this list may be platform sample data rather than live
                restaurants. Do not place an order you are not prepared to have corrected.
              </div>
            )}

            {listState === "loading" && (
              <div className="nabin-skeleton" style={{ height: 180, borderRadius: 20 }} />
            )}

            {listState === "error" && (
              <div className="nabin-alert nabin-alert--danger" role="alert">
                <span>{listError}</span>
                <button type="button" className="nabin-alert__action" onClick={() => void loadRestaurants()}>
                  Retry
                </button>
              </div>
            )}

            {listState === "ready" && restaurants.length === 0 && (
              <div className="nabin-notice">
                {search || openOnly
                  ? "No restaurants match this search. Try a different name or turn off “Open now”."
                  : "No restaurants are listed on the platform yet."}
              </div>
            )}

            {listState === "ready" && restaurants.length > 0 && (
              <div className="nabin-card">
                {restaurants.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    className="nabin-list-row"
                    style={{ width: "100%", textAlign: "left", background: "none", border: "none", cursor: "pointer" }}
                    onClick={() => void openRestaurant(r)}
                  >
                    <span>
                      <strong>{r.name}</strong>
                      <span className="nabin-cell-meta" style={{ display: "block" }}>
                        {r.cuisines?.length ? `${r.cuisines.join(" · ")} — ` : ""}
                        {r.address ?? "Address not listed"}
                      </span>
                    </span>
                    <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      {r.rating !== null && <span className="nabin-num">★ {r.rating.toFixed(1)}</span>}
                      <span className={`nabin-badge ${r.isOpen ? "nabin-badge--success" : "nabin-badge--warning"}`}>
                        {r.isOpen ? "Open" : "Closed"}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </>
        )}

        {active && (
          <>
            <div style={{ display: "flex", gap: "var(--space-sm)", alignItems: "center", flexWrap: "wrap" }}>
              <button type="button" className="nabin-btn nabin-btn--ghost" onClick={closeRestaurant} disabled={busy}>
                ← All restaurants
              </button>
              <span className="nabin-cell-meta">{active.address ?? ""}</span>
            </div>

            {menuDegraded && (
              <div className="nabin-notice">
                Menu could not be read from the store; availability below may be inaccurate.
              </div>
            )}

            {menuState === "loading" && <div className="nabin-skeleton" style={{ height: 220, borderRadius: 20 }} />}

            {menuState === "error" && (
              <div className="nabin-alert nabin-alert--danger" role="alert">
                <span>{menuError}</span>
                <button type="button" className="nabin-alert__action" onClick={() => void openMenuRefresh(active)}>
                  Retry
                </button>
              </div>
            )}

            {menuState === "ready" && menu.length === 0 && (
              <div className="nabin-notice">This restaurant has not listed any dishes yet.</div>
            )}

            {menuState === "ready" && categories.length > 1 && (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {["ALL", ...categories].map((c) => (
                  <button
                    key={c}
                    type="button"
                    className={`nabin-btn ${category === c ? "" : "nabin-btn--ghost"}`}
                    onClick={() => setCategory(c)}
                    disabled={busy}
                  >
                    {c === "ALL" ? "All dishes" : c}
                  </button>
                ))}
              </div>
            )}

            {menuState === "ready" && visibleMenu.length === 0 && (
              <div className="nabin-notice">No dishes in this category.</div>
            )}

            {menuState === "ready" && visibleMenu.length > 0 && (
              <div className="nabin-card">
                {visibleMenu.map((item) => {
                  const qty = qtyInCart(item.id);
                  const soldOut = !item.isAvailable;
                  return (
                    <div key={item.id} className="nabin-list-row">
                      <span>
                        <strong>{item.name}</strong>
                        {item.description && (
                          <span className="nabin-cell-meta" style={{ display: "block" }}>
                            {item.description}
                          </span>
                        )}
                        <span className="nabin-cell-meta" style={{ display: "block" }}>
                          {item.sellingPrice !== item.price ? (
                            <>
                              <span className="nabin-num">{inr(item.sellingPrice)}</span>
                              {" · "}
                              <s className="nabin-num">{inr(item.price)}</s>
                              {item.discountPercent ? ` · ${item.discountPercent}% off` : ""}
                            </>
                          ) : (
                            <span className="nabin-num">{inr(item.price)}</span>
                          )}
                        </span>
                      </span>
                      <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        {soldOut && <span className="nabin-badge nabin-badge--warning">Sold out</span>}
                        <button
                          type="button"
                          className="nabin-btn nabin-btn--ghost"
                          onClick={() => setQty(item, qty - 1)}
                          disabled={busy || qty === 0}
                          aria-label={`Remove one ${item.name}`}
                        >
                          −
                        </button>
                        <span className="nabin-num" aria-live="polite">
                          {qty}
                        </span>
                        <button
                          type="button"
                          className="nabin-btn"
                          onClick={() => setQty(item, qty + 1)}
                          disabled={busy || soldOut}
                          aria-label={`Add one ${item.name}`}
                        >
                          +
                        </button>
                      </span>
                    </div>
                  );
                })}
              </div>
            )}

            {order && (
              <div className="nabin-alert nabin-alert--success" role="status">
                <h2>Order placed</h2>
                <div className="nabin-list-row">
                  <span className="nabin-cell-meta">Order</span>
                  <span className="nabin-mono">{order.orderNumber || order.id}</span>
                </div>
                {(order.lines ?? []).map((line, index) => (
                  <div key={index} className="nabin-list-row">
                    <span style={{ fontWeight: 700 }}>
                      {line.quantity}× {line.product_name_snapshot}
                    </span>
                    <span className="nabin-num">{inr(line.line_total)}</span>
                  </div>
                ))}
                <div className="nabin-list-row">
                  <span className="nabin-cell-meta">Total charged (server priced)</span>
                  <span className="nabin-order__amount nabin-num">{inr(order.totalAmount)}</span>
                </div>
                <div className="nabin-list-row" style={{ borderBottom: "none" }}>
                  <span className="nabin-cell-meta">Delivering to {deliveryAddress}</span>
                  <span className="nabin-badge nabin-badge--warning">{order.status ?? "RECEIVED"}</span>
                </div>
                <p style={{ marginTop: "var(--space-sm)", fontSize: 13 }}>
                  <Link href="/orders" className="nabin-alert__action" style={{ margin: 0 }}>
                    Track it in My orders
                  </Link>
                </p>
              </div>
            )}

            {failure && (
              <div className="nabin-alert nabin-alert--danger" role="alert">
                <span>{failure}</span>
              </div>
            )}

            {cartCount > 0 && (
              <form onSubmit={handleSubmit} className="nabin-form nabin-card">
                <h2>Your order</h2>
                {cart.map((line) => (
                  <div key={line.productId} className="nabin-list-row">
                    <span>
                      {line.quantity}× {line.name}
                    </span>
                    <span className="nabin-num">{inr(line.unitPrice * line.quantity)}</span>
                  </div>
                ))}
                <div className="nabin-list-row">
                  <span className="nabin-cell-meta">Estimated subtotal</span>
                  <span className="nabin-order__amount nabin-num">{inr(estimate)}</span>
                </div>

                <div>
                  <label className="nabin-label" htmlFor="address">
                    Delivery address
                  </label>
                  <input
                    id="address"
                    className="nabin-input"
                    type="text"
                    value={deliveryAddress}
                    onChange={(e) => setDeliveryAddress(e.target.value)}
                    placeholder="e.g. North Campus Girls Hostel, Delhi"
                    disabled={busy}
                    required
                  />
                </div>

                <p className="nabin-cell-meta">
                  The kitchen&apos;s catalogue sets the final prices and availability when the order is
                  placed, so the total may differ from this estimate.
                </p>

                <button type="submit" className="nabin-btn nabin-btn--primary" disabled={busy}>
                  {busy ? "Placing order…" : `Place order (${cartCount})`}
                </button>
              </form>
            )}
          </>
        )}
      </FlowPage>
    </AppShell>
  );
}
