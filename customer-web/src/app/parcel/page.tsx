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

export default function ParcelPage() {
  const { user } = useAuth();
  const [pickup, setPickup] = useState("");
  const [drop, setDrop] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState<JobResponse | null>(null);

  const handleBook = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pickup || !drop) {
      setError("Please enter both pickup and drop addresses");
      return;
    }
    
    setLoading(true);
    setError("");
    setSuccess(null);

    try {
      const res = await bookingApi.bookParcel({
        senderDetails: { address: pickup },
        recipientDetails: { address: drop },
        customerId: user?.id,
      });

      if (res.data.success) {
        setSuccess(res.data.job);
        setPickup("");
        setDrop("");
      } else {
        setError(res.data.error || "Failed to book parcel");
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
        <h1 style={{ fontSize: "1.5rem", margin: 0 }}>Send a Parcel</h1>
      </header>

      {success && (
        <div style={{ marginBottom: "2rem", padding: "1.5rem", background: "rgba(16, 185, 129, 0.1)", borderRadius: "var(--radius-md)", border: "1px solid var(--success)" }}>
          <h2 style={{ color: "var(--success)", marginBottom: "0.5rem" }}>Parcel Booked Successfully!</h2>
          <p><strong>Job ID:</strong> {success.id}</p>
          <p><strong>Status:</strong> {success.status}</p>
        </div>
      )}

      <div className="card">
        <form onSubmit={handleBook} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          {error && <div style={{ color: "var(--error)", padding: "0.5rem", background: "rgba(239, 68, 68, 0.1)", borderRadius: "var(--radius-sm)" }}>{error}</div>}
          
          <div>
            <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: "500" }}>Pickup Address</label>
            <input
              type="text"
              value={pickup}
              onChange={(e) => setPickup(e.target.value)}
              placeholder="e.g. Kamla Nagar Market, Block C"
              className="input"
              disabled={loading}
              required
            />
          </div>

          <div>
            <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: "500" }}>Drop Address</label>
            <input
              type="text"
              value={drop}
              onChange={(e) => setDrop(e.target.value)}
              placeholder="e.g. Karol Bagh Electronics Hub"
              className="input"
              disabled={loading}
              required
            />
          </div>

          <button type="submit" className="btn-primary" disabled={loading} style={{ marginTop: "1rem" }}>
            {loading ? "Booking..." : "Confirm Booking"}
          </button>
        </form>
      </div>
    </div>
  );
}
