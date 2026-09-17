"use client";

import { useEffect, useState } from "react";
import { bookingApi } from "@/lib/api";
import Link from "next/link";
import { useAuth } from "@/context/AuthContext";
import { useRouter } from "next/navigation";

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
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!authLoading && !user) {
      router.push("/login");
    }
  }, [user, authLoading, router]);

  useEffect(() => {
    const fetchOrders = async () => {
      try {
        const res = await bookingApi.getOrders();
        if (res.data.success) {
          setOrders(res.data.orders);
        } else {
          setError(res.data.error || "Failed to load orders");
        }
      } catch (err: unknown) {
        const error = err as { response?: { data?: { error?: string } } };
        setError(error.response?.data?.error || "Error connecting to server");
      } finally {
        setLoading(false);
      }
    };
    if (user) {
      fetchOrders();
    }
  }, [user]);

  if (authLoading || !user) {
    return <div className="container" style={{ padding: "2rem" }}>Loading...</div>;
  }

  return (
    <div className="container" style={{ padding: "2rem 1rem", maxWidth: "800px" }}>
      <header style={{ marginBottom: "2rem", display: "flex", alignItems: "center", gap: "1rem", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
          <Link href="/" style={{ color: "var(--text-muted)", fontSize: "1.25rem", textDecoration: "none" }}>
            &larr;
          </Link>
          <h1 style={{ fontSize: "1.5rem", margin: 0 }}>My Orders</h1>
        </div>
      </header>

      {error && <div style={{ color: "var(--error)", padding: "1rem", background: "rgba(239, 68, 68, 0.1)", borderRadius: "var(--radius-md)", marginBottom: "2rem" }}>{error}</div>}

      {loading ? (
        <div>Loading your order history...</div>
      ) : orders.length === 0 ? (
        <div className="card" style={{ textAlign: "center", padding: "3rem" }}>
          <p style={{ color: "var(--text-muted)" }}>You have no past orders yet.</p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          {orders.map((order) => (
            <div key={order.id || order.checkout_id} className="card" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <h3 style={{ fontSize: "1.125rem", marginBottom: "0.25rem" }}>{order.service_type || "Order"}</h3>
                <p style={{ color: "var(--text-muted)", fontSize: "0.875rem", marginBottom: "0.25rem" }}>
                  ID: {order.checkout_id || order.id}
                </p>
                <p style={{ color: "var(--text-muted)", fontSize: "0.875rem" }}>
                  {new Date(order.created_at).toLocaleString()}
                </p>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontWeight: "600", fontSize: "1.125rem", color: "var(--primary)", marginBottom: "0.25rem" }}>
                  NPR {order.final_payable_amount}
                </div>
                <div style={{ fontSize: "0.75rem", background: "var(--surface-hover)", padding: "0.25rem 0.5rem", borderRadius: "var(--radius-sm)", display: "inline-block", fontWeight: "500" }}>
                  {order.status}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
