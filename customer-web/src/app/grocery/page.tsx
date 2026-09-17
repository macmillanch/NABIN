"use client";

import { useState } from "react";
import { bookingApi } from "@/lib/api";
import Link from "next/link";

interface JobResponse {
  id?: string;
  orderId?: string;
  checkout_id?: string;
  status?: string;
  checkoutStatus?: string;
  [key: string]: unknown;
}

export default function GroceryPage() {
  const [storeId, setStoreId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState<JobResponse | null>(null);

  const handleCheckout = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!storeId) {
      setError("Please enter a Store ID");
      return;
    }
    
    setLoading(true);
    setError("");
    setSuccess(null);

    try {
      const res = await bookingApi.checkoutGrocery({
        merchantId: storeId,
        paymentMethod: "CASH",
        items: [{ itemId: "groc_1", quantity: 2, price: 100 }],
      });

      if (res.data.success) {
        setSuccess(res.data.checkout || res.data.order || res.data);
        setStoreId("");
      } else {
        setError(res.data.error || "Failed to checkout grocery");
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
        <h1 style={{ fontSize: "1.5rem", margin: 0 }}>Grocery Checkout</h1>
      </header>

      <div style={{ marginBottom: "2rem", padding: "1rem", background: "rgba(245, 158, 11, 0.1)", color: "var(--warning)", borderRadius: "var(--radius-md)", fontSize: "0.875rem" }}>
        <strong>Note:</strong> Browsing products is unsupported here. Enter a known independent Store ID (e.g., mcht_1). Darkstores are strictly rejected.
      </div>

      {success && (
        <div style={{ marginBottom: "2rem", padding: "1.5rem", background: "rgba(16, 185, 129, 0.1)", borderRadius: "var(--radius-md)", border: "1px solid var(--success)" }}>
          <h2 style={{ color: "var(--success)", marginBottom: "0.5rem" }}>Checkout Validated Successfully!</h2>
          <p><strong>Checkout ID:</strong> {success.checkout_id || success.id || success.orderId || "Generated"}</p>
          <p><strong>Status:</strong> {success.checkoutStatus || success.status || "CONFIRMED"}</p>
        </div>
      )}

      <div className="card">
        <form onSubmit={handleCheckout} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          {error && <div style={{ color: "var(--error)", padding: "0.5rem", background: "rgba(239, 68, 68, 0.1)", borderRadius: "var(--radius-sm)" }}>{error}</div>}
          
          <div>
            <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: "500" }}>Store ID (Merchant)</label>
            <input
              type="text"
              value={storeId}
              onChange={(e) => setStoreId(e.target.value)}
              placeholder="e.g. mcht_1"
              className="input"
              disabled={loading}
              required
            />
          </div>

          <button type="submit" className="btn-primary" disabled={loading} style={{ marginTop: "1rem" }}>
            {loading ? "Validating..." : "Express Checkout"}
          </button>
        </form>
      </div>
    </div>
  );
}
