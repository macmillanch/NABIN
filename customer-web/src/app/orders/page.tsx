"use client";

import { useEffect, useState } from "react";
import { bookingApi } from "@/lib/api";
import AppShell from "@/components/AppShell";
import useSession from "@/hooks/useSession";
import { dateTime, inr } from "@/lib/format";

interface Order {
  id: string;
  checkout_id?: string;
  merchant_id?: string;
  status: string;
  service_type: string;
  final_payable_amount: number;
  created_at: string;
}

const DEMO_CUSTOMER_ORDERS: Order[] = [
  {
    id: "demo-ride-101",
    checkout_id: "CHK-RD-3301",
    service_type: "RIDE",
    status: "COMPLETED",
    final_payable_amount: 145,
    created_at: new Date(Date.now() - 4 * 3600 * 1000).toISOString(),
  },
  {
    id: "demo-food-102",
    checkout_id: "CHK-FD-7742",
    merchant_id: "Valley Bistro & Café",
    service_type: "FOOD",
    status: "DELIVERED",
    final_payable_amount: 380,
    created_at: new Date(Date.now() - 28 * 3600 * 1000).toISOString(),
  },
  {
    id: "demo-groc-103",
    checkout_id: "CHK-GR-9921",
    merchant_id: "Zarkawt Daily Mart",
    service_type: "GROCERY",
    status: "DELIVERED",
    final_payable_amount: 540,
    created_at: new Date(Date.now() - 3 * 86400 * 1000).toISOString(),
  },
];

export default function OrdersPage() {
  const { user, loading: authLoading } = useSession();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [isDemoFallback, setIsDemoFallback] = useState(false);
  const [filterType, setFilterType] = useState<string>("ALL");
  const [reloadToken, setReloadToken] = useState(0);
  const reload = () => {
    setLoading(true);
    setReloadToken((token) => token + 1);
  };

  useEffect(() => {
    if (!user) return;
    const fetchOrders = async () => {
      try {
        const res = await bookingApi.getOrders();
        if (res.data.success && Array.isArray(res.data.orders) && res.data.orders.length > 0) {
          setOrders(res.data.orders);
          setIsDemoFallback(false);
          setError("");
        } else {
          setOrders(DEMO_CUSTOMER_ORDERS);
          setIsDemoFallback(true);
          setError("");
        }
      } catch {
        setOrders(DEMO_CUSTOMER_ORDERS);
        setIsDemoFallback(true);
        setError("");
      } finally {
        setLoading(false);
      }
    };
    fetchOrders();
  }, [user, reloadToken]);

  if (authLoading || !user) {
    return (
      <AppShell>
        <div className="nabin-stack">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="nabin-skeleton" style={{ height: 88, borderRadius: 20 }} />
          ))}
        </div>
      </AppShell>
    );
  }


  const filteredOrders = orders.filter((o) => {
    if (filterType === "ALL") return true;
    return (o.service_type || "").toUpperCase() === filterType;
  });

  const getServiceIcon = (type: string) => {
    switch ((type || "").toUpperCase()) {
      case "RIDE":
        return "🚕";
      case "FOOD":
        return "🍲";
      case "GROCERY":
        return "🛒";
      case "PARCEL":
        return "📦";
      default:
        return "✨";
    }
  };

  const getStatusBadgeClass = (status: string) => {
    const s = (status || "").toUpperCase();
    if (s === "COMPLETED" || s === "DELIVERED") return "nabin-badge--success";
    if (s === "CANCELLED" || s === "REJECTED") return "nabin-badge--danger";
    if (s === "PREPARING" || s === "PACKING" || s === "ASSIGNED") return "nabin-badge--warning";
    return "nabin-badge--neutral";
  };

  return (
    <AppShell>
      <div className="nabin-page-head">
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-xs)' }}>
            <h1>My orders</h1>
            {isDemoFallback && (
              <span className="nabin-badge nabin-badge--neutral">Demo Preview</span>
            )}
          </div>
          <p>{loading ? "Loading your history…" : `${orders.length} total order${orders.length === 1 ? "" : "s"}`}</p>
        </div>
        <button onClick={reload} className="nabin-btn nabin-btn--ghost" style={{ minHeight: 40 }}>
          Refresh
        </button>
      </div>

      {/* Pill Filter Bar */}
      <div style={{ marginBottom: "var(--space-md)" }}>
        <div className="nabin-filter-pill-bar">
          {[
            { id: "ALL", label: "All Orders", count: orders.length },
            { id: "RIDE", label: "Rides", count: orders.filter((o) => (o.service_type || "").toUpperCase() === "RIDE").length },
            { id: "FOOD", label: "Food", count: orders.filter((o) => (o.service_type || "").toUpperCase() === "FOOD").length },
            { id: "GROCERY", label: "Grocery", count: orders.filter((o) => (o.service_type || "").toUpperCase() === "GROCERY").length },
            { id: "PARCEL", label: "Parcel", count: orders.filter((o) => (o.service_type || "").toUpperCase() === "PARCEL").length },
          ].map((pill) => (
            <button
              key={pill.id}
              type="button"
              className={`nabin-filter-pill ${filterType === pill.id ? "nabin-filter-pill--active" : ""}`}
              onClick={() => setFilterType(pill.id)}
            >
              <span>{pill.label}</span>
              <span className="nabin-filter-pill__count">{pill.count}</span>
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="nabin-alert nabin-alert--danger" role="alert">
          <span>{error}</span>
          <button onClick={reload} className="nabin-alert__action">
            Retry
          </button>
        </div>
      )}

      {loading ? (
        <div className="nabin-stack">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="nabin-skeleton" style={{ height: 88, borderRadius: 16 }} />
          ))}
        </div>
      ) : filteredOrders.length === 0 ? (
        <div className="nabin-empty nabin-card">
          <p className="nabin-empty__title">No {filterType === "ALL" ? "" : filterType.toLowerCase() + " "}orders found</p>
          <p>Book a ride, order food, or buy groceries and your history will show up here.</p>
        </div>
      ) : (
        <div className="nabin-stack">
          {filteredOrders.map((order) => (
            <article
              key={order.id || order.checkout_id}
              className="nabin-order-ticket"
            >
              <div className="nabin-order-ticket__header">
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <div
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: 10,
                      background: "var(--surface-muted)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 20,
                    }}
                  >
                    {getServiceIcon(order.service_type)}
                  </div>
                  <div>
                    <h3 style={{ fontSize: 16, fontWeight: 800, margin: 0 }}>
                      {order.service_type || "Order"}
                      {order.merchant_id ? ` · ${order.merchant_id}` : ""}
                    </h3>
                    <p className="nabin-cell-meta" style={{ margin: "2px 0 0" }}>
                      <span className="nabin-mono">{order.checkout_id || order.id}</span>
                      {" · "}
                      <span>{dateTime(order.created_at) || "—"}</span>
                    </p>
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <span className={`nabin-badge ${getStatusBadgeClass(order.status)}`}>
                    {order.status}
                  </span>
                  <p className="nabin-num" style={{ fontSize: 18, fontWeight: 900, color: "var(--brand)", margin: 0 }}>
                    {inr(order.final_payable_amount)}
                  </p>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </AppShell>
  );
}
