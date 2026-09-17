"use client";

import { useState } from "react";
import { bookingApi } from "@/lib/api";
import Link from "next/link";
import { useAuth } from "@/context/AuthContext";

interface JobResponse {
  id: string;
  status: string;
  [key: string]: unknown;
}

export default function FoodPage() {
  const { user } = useAuth();
  const [restaurantId, setRestaurantId] = useState("");
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState<JobResponse | null>(null);

  const handleBook = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!restaurantId || !deliveryAddress) {
      setError("Please enter both Restaurant ID and Delivery Address");
      return;
    }
    
    setLoading(true);
    setError("");
    setSuccess(null);

    try {
      const res = await bookingApi.bookFood({
        restaurantId,
        deliveryAddress,
        items: [{ itemId: "item_123", quantity: 1, name: "Test Meal", price: 500 }],
        customerId: user?.id,
      });

      if (res.data.success) {
        setSuccess(res.data.job);
        setRestaurantId("");
        setDeliveryAddress("");
      } else {
        setError(res.data.error || "Failed to order food");
      }
    } catch (err: unknown) {
      const error = err as { response?: { data?: { error?: string } } };
      setError(error.response?.data?.error || "Error connecting to server");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="container" style={{ padding: "2rem 1rem", maxWidth: "600px" }}>
      <header style={{ marginBottom: "2rem", display: "flex", alignItems: "center", gap: "1rem" }}>
        <Link href="/" style={{ color: "var(--text-muted)", fontSize: "1.25rem", textDecoration: "none" }}>
          &larr;
        </Link>
        <h1 style={{ fontSize: "1.5rem", margin: 0 }}>Order Food</h1>
      </header>

      <div style={{ marginBottom: "2rem", padding: "1rem", background: "rgba(245, 158, 11, 0.1)", color: "var(--warning)", borderRadius: "var(--radius-md)", fontSize: "0.875rem" }}>
        <strong>Note:</strong> Browsing restaurants is currently unsupported by the backend. Please enter a known Restaurant ID directly.
      </div>

      {success && (
        <div style={{ marginBottom: "2rem", padding: "1.5rem", background: "rgba(16, 185, 129, 0.1)", borderRadius: "var(--radius-md)", border: "1px solid var(--success)" }}>
          <h2 style={{ color: "var(--success)", marginBottom: "0.5rem" }}>Order Placed Successfully!</h2>
          <p><strong>Order ID:</strong> {success.id}</p>
          <p><strong>Status:</strong> {success.status}</p>
        </div>
      )}

      <div className="card">
        <form onSubmit={handleBook} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          {error && <div style={{ color: "var(--error)", padding: "0.5rem", background: "rgba(239, 68, 68, 0.1)", borderRadius: "var(--radius-sm)" }}>{error}</div>}
          
          <div>
            <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: "500" }}>Restaurant ID</label>
            <input
              type="text"
              value={restaurantId}
              onChange={(e) => setRestaurantId(e.target.value)}
              placeholder="e.g. mcht_123"
              className="input"
              disabled={loading}
              required
            />
          </div>

          <div>
            <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: "500" }}>Delivery Address</label>
            <input
              type="text"
              value={deliveryAddress}
              onChange={(e) => setDeliveryAddress(e.target.value)}
              placeholder="e.g. Thamel, Kathmandu"
              className="input"
              disabled={loading}
              required
            />
          </div>

          <button type="submit" className="btn-primary" disabled={loading} style={{ marginTop: "1rem" }}>
            {loading ? "Placing Order..." : "Place Order"}
          </button>
        </form>
      </div>
    </div>
  );
}
