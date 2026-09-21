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

export default function OrdersPage() {
  const { user, loading: authLoading } = useSession();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
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
        if (res.data.success) {
          setOrders(res.data.orders);
          setError("");
        } else {
          setError(res.data.error || "Failed to load orders");
        }
      } catch {
        setError("Could not reach the NABIN API.");
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

  return (
    <AppShell>
      <div className="nabin-page-head">
        <div>
          <h1>My orders</h1>
          <p>{loading ? "Loading your history…" : `${orders.length} order${orders.length === 1 ? "" : "s"}`}</p>
        </div>
        <button onClick={reload} className="nabin-btn nabin-btn--ghost" style={{ minHeight: 40 }}>
          Refresh
        </button>
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
            <div key={i} className="nabin-skeleton" style={{ height: 88, borderRadius: 20 }} />
          ))}
        </div>
      ) : orders.length === 0 ? (
        <div className="nabin-empty nabin-card">
          <p className="nabin-empty__title">No orders yet</p>
          <p>Book a ride, order food, or buy groceries and your history will show up here.</p>
        </div>
      ) : (
        <div className="nabin-stack">
          {orders.map((order) => (
            <article
              key={order.id || order.checkout_id}
              className="nabin-card nabin-order"
            >
              <div style={{ minWidth: 0 }}>
                <div className="nabin-row" style={{ gap: "var(--space-xs)" }}>
                  <h3 className="nabin-order__service">{order.service_type || "Order"}</h3>
                  <span className="nabin-badge nabin-badge--neutral">{order.status}</span>
                </div>
                <p className="nabin-cell-meta">
                  {order.checkout_id || order.id}
                  {order.merchant_id ? ` · ${order.merchant_id}` : ""}
                </p>
                <p className="nabin-cell-meta">
                  {dateTime(order.created_at) || "—"}
                </p>
              </div>
              <p className="nabin-order__amount nabin-num">{inr(order.final_payable_amount)}</p>
            </article>
          ))}
        </div>
      )}
    </AppShell>
  );
}
