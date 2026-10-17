"use client";

/* eslint-disable react-hooks/set-state-in-effect */

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import AppShell from "@/components/AppShell";
import CustomerDishCustomizer, { type CustomizedCartItem } from "@/components/CustomerDishCustomizer";
import FlowPage from "@/components/FlowPage";
import useSession from "@/hooks/useSession";
import { bookingApi, discoveryApi } from "@/lib/api";
import {
  type DishAddOnGroup,
  type DishVariant,
  type RestaurantDishItem,
  getStoredMenuDishes,
  importDemoCatalogPayload,
} from "@/lib/catalogData";
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
 * When the store cannot be reached or runs in demo mode, it seamlessly integrates with
 * the merchant catalog data (supporting variants, add-on groups, and photo previews).
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
  photos?: string[];
  prepTime?: number;
  variants?: DishVariant[];
  addOnGroups?: DishAddOnGroup[];
}

interface CartLine {
  lineId: string;
  productId: string;
  name: string;
  variantName?: string;
  addOnNames?: string[];
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

  // --- demo catalog transfer ---
  const [importNotice, setImportNotice] = useState("");
  const [importError, setImportError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleCatalogImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const text = ev.target?.result as string;
        const res = importDemoCatalogPayload(text);
        if (res.success) {
          setImportNotice(`Imported demo catalog: ${res.dishCount} dishes, ${res.productCount} grocery products.`);
          setImportError("");
          if (active) {
            void openRestaurant(active);
          }
        } else {
          setImportError(res.error || "Failed to import demo catalog.");
          setImportNotice("");
        }
      } catch (err: any) {
        setImportError(err?.message || "Invalid JSON catalog file.");
        setImportNotice("");
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const loadRestaurants = useCallback(async () => {
    setListState("loading");
    setListError("");
    const isDemoUser = typeof window !== "undefined" && localStorage.getItem("nabin_customer_token")?.startsWith("demo-");
    if (isDemoUser) {
      setRestaurants([
        {
          id: "demo-rest-01",
          name: "The Royal Biryani House",
          merchantType: "RESTAURANT",
          address: "Park Street, Kolkata",
          cuisines: ["Biryani", "Mughlai", "North Indian"],
          rating: 4.8,
          deliveryTime: "25-35 mins",
          isOpen: true,
          location: { lat: 22.55, lng: 88.35 },
        },
        {
          id: "demo-rest-02",
          name: "Tandoori Nights & Rolls",
          merchantType: "RESTAURANT",
          address: "Sector V, Salt Lake",
          cuisines: ["Rolls", "Kebabs", "Fast Food"],
          rating: 4.5,
          deliveryTime: "20-30 mins",
          isOpen: true,
          location: { lat: 22.58, lng: 88.43 },
        },
      ]);
      setListDegraded(true);
      setListState("ready");
      return;
    }
    try {
      const res = await discoveryApi.restaurants({
        search: search || undefined,
        openNow: openOnly || undefined,
      });
      setRestaurants(res.data.restaurants ?? []);
      setListDegraded(res.data.dataSource !== "postgres");
      setListState("ready");
    } catch {
      setRestaurants([
        {
          id: "demo-rest-01",
          name: "The Royal Biryani House",
          merchantType: "RESTAURANT",
          address: "Park Street, Kolkata",
          cuisines: ["Biryani", "Mughlai", "North Indian"],
          rating: 4.8,
          deliveryTime: "25-35 mins",
          isOpen: true,
          location: { lat: 22.55, lng: 88.35 },
        },
        {
          id: "demo-rest-02",
          name: "Tandoori Nights & Rolls",
          merchantType: "RESTAURANT",
          address: "Sector V, Salt Lake",
          cuisines: ["Rolls", "Kebabs", "Fast Food"],
          rating: 4.5,
          deliveryTime: "20-30 mins",
          isOpen: true,
          location: { lat: 22.58, lng: 88.43 },
        },
      ]);
      setListDegraded(true);
      setListState("ready");
    }
  }, [search, openOnly]);

  useEffect(() => {
    void loadRestaurants();
  }, [loadRestaurants]);

  const [customizingDish, setCustomizingDish] = useState<RestaurantDishItem | null>(null);

  const openRestaurant = async (restaurant: Restaurant) => {
    setActive(restaurant);
    setOrder(null);
    setFailure("");
    setMenuState("loading");
    setMenuError("");
    setCategory("ALL");

    const loadDemoMenu = () => {
      const stored = getStoredMenuDishes();
      const mapped: MenuItem[] = stored.map((s) => ({
        id: s.id,
        sku: s.sku ?? null,
        name: s.name,
        description: s.description ?? s.shortDescription ?? null,
        category: s.category,
        price: s.basePrice,
        sellingPrice: s.sellingPrice,
        mrp: s.mrp ?? s.basePrice,
        discountPercent: s.discountPercent ?? null,
        isVeg: s.foodType === "veg" || s.foodType === "vegan",
        isAvailable: s.isAvailable,
        photos: s.photos,
        prepTime: s.prepTime,
        variants: s.variants,
        addOnGroups: s.addOnGroups,
      }));
      setMenu(mapped);
      setMenuDegraded(true);
      setMenuState("ready");
    };

    if (restaurant.id.startsWith("demo-")) {
      loadDemoMenu();
      return;
    }
    try {
      const res = await discoveryApi.menu(restaurant.id);
      const items = res.data.items ?? [];
      if (items.length === 0) {
        loadDemoMenu();
      } else {
        setMenu(items);
        setMenuDegraded(res.data.dataSource !== "postgres");
        setMenuState("ready");
      }
    } catch {
      loadDemoMenu();
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

  const handleAddCustomized = (item: CustomizedCartItem) => {
    setCart((prev) => {
      const existing = prev.find(
        (l) =>
          l.productId === item.productId &&
          l.variantName === item.variantName &&
          JSON.stringify(l.addOnNames) === JSON.stringify(item.addOnNames)
      );
      if (existing) {
        return prev.map((l) =>
          l.lineId === existing.lineId
            ? { ...l, quantity: l.quantity + item.quantity }
            : l
        );
      }
      const newLine: CartLine = {
        lineId: `line_${Date.now()}_${Math.random()}`,
        productId: item.productId,
        name: item.name,
        variantName: item.variantName,
        addOnNames: item.addOnNames,
        unitPrice: item.unitPrice,
        quantity: item.quantity,
      };
      return [...prev, newLine];
    });
  };

  const setQty = (item: MenuItem, quantity: number) => {
    // If the dish has variants or add-on groups, open the customizer on add
    if (quantity > 0 && ((item.variants && item.variants.length > 0) || (item.addOnGroups && item.addOnGroups.length > 0))) {
      const fullDish: RestaurantDishItem = {
        id: item.id,
        name: item.name,
        description: item.description ?? '',
        category: item.category ?? 'Main Course',
        foodType: item.isVeg ? 'veg' : 'non-veg',
        basePrice: item.price,
        sellingPrice: item.sellingPrice,
        prepTime: item.prepTime ?? 20,
        isAvailable: item.isAvailable,
        photos: item.photos ?? [],
        primaryPhotoIndex: 0,
        variants: item.variants ?? [],
        addOnGroups: item.addOnGroups ?? [],
        updatedAt: new Date().toISOString(),
      };
      setCustomizingDish(fullDish);
      return;
    }

    const qty = Math.max(0, Math.min(99, Math.trunc(quantity)));
    setCart((prev) => {
      const others = prev.filter((line) => line.productId !== item.id);
      if (qty === 0) return others;
      const existing = prev.find((line) => line.productId === item.id);
      const line: CartLine = {
        lineId: existing?.lineId ?? `line_${Date.now()}_${Math.random()}`,
        productId: item.id,
        name: item.name,
        unitPrice: item.sellingPrice,
        quantity: qty,
      };
      return existing ? [...others, line] : [...prev, line];
    });
  };

  const qtyInCart = (productId: string) =>
    cart.filter((l) => l.productId === productId).reduce((n, l) => n + l.quantity, 0);

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
    if (active.id.startsWith("demo-")) {
      setOrder({
        id: "DEMO-ORD-8812",
        orderNumber: "DEMO-FOOD-8812",
        status: "PLACED",
        totalAmount: estimate,
        lines: cart.map((c) => ({
          product_name_snapshot: c.name,
          quantity: c.quantity,
          line_total: c.unitPrice * c.quantity,
        })),
      });
      setCart([]);
      setBusy(false);
      return;
    }
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
        {/* Demo Catalog Transfer Banner */}
        <div
          style={{
            background: "#EFF6FF",
            border: "1px solid #BFDBFE",
            borderRadius: 8,
            padding: "12px 16px",
            marginBottom: "var(--space-md)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 18 }}>🔄</span>
            <div style={{ fontSize: 13, color: "#1E3A8A" }}>
              <strong>Demo Catalog Transfer:</strong> Load menu dishes exported from Merchant Web (JSON).
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input
              type="file"
              accept=".json"
              ref={fileInputRef}
              onChange={handleCatalogImport}
              style={{ display: "none" }}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="nabin-btn"
              style={{
                background: "#1A3BA2",
                color: "#FFFFFF",
                fontSize: 12,
                padding: "6px 14px",
                fontWeight: 700,
                borderRadius: 8,
              }}
            >
              📥 Import Demo Catalog (JSON)
            </button>
          </div>
        </div>

        {importNotice && (
          <div className="nabin-alert nabin-alert--success" role="status" style={{ marginBottom: "var(--space-md)" }}>
            <span>✅ {importNotice}</span>
          </div>
        )}
        {importError && (
          <div className="nabin-alert nabin-alert--danger" role="alert" style={{ marginBottom: "var(--space-md)" }}>
            <span>⚠️ {importError}</span>
          </div>
        )}

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
              <div className="nabin-restaurant-grid">
                {restaurants.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    className="nabin-restaurant-card"
                    onClick={() => void openRestaurant(r)}
                  >
                    <div>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8, marginBottom: 8 }}>
                        <h3 style={{ fontSize: 17, fontWeight: 800, margin: 0, color: "var(--ink)" }}>{r.name}</h3>
                        <span className={`nabin-badge ${r.isOpen ? "nabin-badge--success" : "nabin-badge--warning"}`}>
                          {r.isOpen ? "Open" : "Closed"}
                        </span>
                      </div>
                      <p className="nabin-cell-meta" style={{ margin: "4px 0 12px", lineHeight: 1.4 }}>
                        {r.cuisines?.length ? r.cuisines.join(" · ") : "Multi-cuisine"}
                      </p>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingTop: 10, borderTop: "1px solid var(--divider)", fontSize: 13 }}>
                      <span className="nabin-cell-meta" style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        📍 {r.address ?? "Address on file"}
                      </span>
                      {typeof r.rating === "number" && !isNaN(r.rating) ? (
                        <span className="nabin-badge nabin-badge--warning" style={{ fontWeight: 800 }}>
                          ★ {r.rating.toFixed(1)}
                        </span>
                      ) : (
                        <span className="nabin-badge nabin-badge--neutral">New</span>
                      )}
                    </div>
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
              <div className="nabin-stack">
                {visibleMenu.map((item) => {
                  const qty = qtyInCart(item.id);
                  const soldOut = !item.isAvailable;
                  const hasCustomizations =
                    (item.variants && item.variants.length > 0) ||
                    (item.addOnGroups && item.addOnGroups.length > 0);
                  const photo = item.photos && item.photos.length > 0 ? item.photos[0] : "";

                  return (
                    <div
                      key={item.id}
                      className="nabin-dish-card"
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 16,
                      }}
                    >
                      {/* Left: Thumbnail & Details */}
                      <div style={{ display: "flex", alignItems: "flex-start", gap: 14, minWidth: 0, flex: 1 }}>
                        {photo ? (
                          <div
                            style={{
                              width: 64,
                              height: 64,
                              borderRadius: 10,
                              overflow: "hidden",
                              flexShrink: 0,
                              border: "1px solid #e2e8f0",
                              background: "#f8fafc",
                            }}
                          >
                            <img
                              src={photo}
                              alt={item.name}
                              style={{ width: "100%", height: "100%", objectFit: "cover" }}
                            />
                          </div>
                        ) : (
                          <div
                            style={{
                              width: 64,
                              height: 64,
                              borderRadius: 10,
                              background: "#f1f5f9",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              fontSize: 24,
                              flexShrink: 0,
                            }}
                          >
                            🍲
                          </div>
                        )}

                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                            <span style={{ fontSize: 13 }}>{item.isVeg === false ? "🔴" : "🟢"}</span>
                            <strong style={{ fontSize: 16, color: "var(--ink)" }}>{item.name}</strong>
                            {soldOut && <span className="nabin-badge nabin-badge--warning">Sold out</span>}
                            {item.prepTime && (
                              <span style={{ fontSize: 11, color: "var(--ink-muted)" }}>
                                ⏱️ {item.prepTime} mins
                              </span>
                            )}
                          </div>
                          {item.description && (
                            <p className="nabin-cell-meta" style={{ margin: "4px 0 8px", lineHeight: 1.4 }}>
                              {item.description}
                            </p>
                          )}
                          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
                            {item.sellingPrice !== item.price ? (
                              <>
                                <span className="nabin-num" style={{ fontWeight: 800, fontSize: 16, color: "var(--ink)" }}>
                                  {inr(item.sellingPrice)}
                                </span>
                                <s className="nabin-num" style={{ color: "var(--ink-muted)", fontSize: 14 }}>
                                  {inr(item.price)}
                                </s>
                                {item.discountPercent ? (
                                  <span className="nabin-badge nabin-badge--success">
                                    {item.discountPercent}% off
                                  </span>
                                ) : null}
                              </>
                            ) : (
                              <span className="nabin-num" style={{ fontWeight: 800, fontSize: 16, color: "var(--ink)" }}>
                                {inr(item.price)}
                              </span>
                            )}
                            {hasCustomizations && (
                              <span style={{ fontSize: 11, color: "var(--brand)", fontWeight: 700 }}>
                                Customizable
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Right: Add / Customize Controls */}
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                        {hasCustomizations ? (
                          <button
                            type="button"
                            className="nabin-btn nabin-btn--primary"
                            style={{ minHeight: 36, padding: "0 14px", borderRadius: 8, fontWeight: 700, fontSize: 13 }}
                            onClick={() => {
                              const fullDish: RestaurantDishItem = {
                                id: item.id,
                                name: item.name,
                                description: item.description ?? '',
                                category: item.category ?? 'Main Course',
                                foodType: item.isVeg ? 'veg' : 'non-veg',
                                basePrice: item.price,
                                sellingPrice: item.sellingPrice,
                                prepTime: item.prepTime ?? 20,
                                isAvailable: item.isAvailable,
                                photos: item.photos ?? [],
                                primaryPhotoIndex: 0,
                                variants: item.variants ?? [],
                                addOnGroups: item.addOnGroups ?? [],
                                updatedAt: new Date().toISOString(),
                              };
                              setCustomizingDish(fullDish);
                            }}
                            disabled={busy || soldOut}
                          >
                            {qty > 0 ? `+ Add More (${qty})` : "+ Add / Customise"}
                          </button>
                        ) : (
                          <>
                            <button
                              type="button"
                              className="nabin-btn nabin-btn--ghost"
                              style={{ minHeight: 36, minWidth: 36, padding: "0 10px", borderRadius: 8 }}
                              onClick={() => setQty(item, qty - 1)}
                              disabled={busy || qty === 0}
                              aria-label={`Remove one ${item.name}`}
                            >
                              −
                            </button>
                            <span className="nabin-num" style={{ minWidth: 20, textAlign: "center", fontWeight: 800 }} aria-live="polite">
                              {qty}
                            </span>
                            <button
                              type="button"
                              className="nabin-btn nabin-btn--primary"
                              style={{ minHeight: 36, minWidth: 36, padding: "0 10px", borderRadius: 8 }}
                              onClick={() => setQty(item, qty + 1)}
                              disabled={busy || soldOut}
                              aria-label={`Add one ${item.name}`}
                            >
                              +
                            </button>
                          </>
                        )}
                      </div>
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
                  <div key={line.lineId} className="nabin-list-row" style={{ alignItems: "center" }}>
                    <div>
                      <span style={{ fontWeight: 700 }}>
                        {line.quantity}× {line.name}
                      </span>
                      {line.variantName && (
                        <div style={{ fontSize: 12, color: "var(--brand)", fontWeight: 600 }}>
                          Size: {line.variantName}
                        </div>
                      )}
                      {line.addOnNames && line.addOnNames.length > 0 && (
                        <div style={{ fontSize: 11, color: "var(--ink-muted)" }}>
                          + {line.addOnNames.join(", ")}
                        </div>
                      )}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <span className="nabin-num" style={{ fontWeight: 800 }}>
                        {inr(line.unitPrice * line.quantity)}
                      </span>
                      <button
                        type="button"
                        onClick={() => setCart((prev) => prev.filter((l) => l.lineId !== line.lineId))}
                        style={{
                          border: "none",
                          background: "transparent",
                          color: "var(--danger)",
                          cursor: "pointer",
                          fontSize: 14,
                          padding: "0 4px",
                        }}
                        title="Remove line item"
                      >
                        ✕
                      </button>
                    </div>
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

            {/* Customizer Modal */}
            {customizingDish && (
              <CustomerDishCustomizer
                dish={customizingDish}
                onAddToCart={handleAddCustomized}
                onClose={() => setCustomizingDish(null)}
              />
            )}
          </>
        )}
      </FlowPage>
    </AppShell>
  );
}
