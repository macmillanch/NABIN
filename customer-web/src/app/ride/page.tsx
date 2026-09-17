"use client";

import { useState } from "react";
import { bookingApi } from "@/lib/api";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/context/AuthContext";

export default function RidePage() {
  const router = useRouter();
  const { user } = useAuth();
  const [pickup, setPickup] = useState("");
  const [drop, setDrop] = useState("");
  const [vehicleType, setVehicleType] = useState("TAXI");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  interface JobResponse {
    id: string;
    status: string;
    estimatedFare?: number;
  }
  const [success, setSuccess] = useState<JobResponse | null>(null);

  const handleBook = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pickup || !drop) {
      setError("Please enter both pickup and drop locations");
      return;
    }
    
    setLoading(true);
    setError("");
    setSuccess(null);

    try {
      const res = await bookingApi.bookRide({
        pickup,
        drop,
        vehicleType,
        customerId: user?.id,
      });

      if (res.data.success) {
        setSuccess(res.data.job);
        setPickup("");
        setDrop("");
      } else {
        setError(res.data.error || "Failed to book ride");
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
        <h1 style={{ fontSize: "1.5rem", margin: 0 }}>Book a Ride</h1>
      </header>

      {success && (
        <div style={{ marginBottom: "2rem", padding: "1.5rem", background: "rgba(16, 185, 129, 0.1)", borderRadius: "var(--radius-md)", border: "1px solid var(--success)" }}>
          <h2 style={{ color: "var(--success)", marginBottom: "0.5rem" }}>Ride Booked Successfully!</h2>
          <p><strong>Job ID:</strong> {success.id}</p>
          <p><strong>Status:</strong> {success.status}</p>
          <p><strong>Estimated Fare:</strong> NPR {success.estimatedFare}</p>
        </div>
      )}

      <div className="card">
        <form onSubmit={handleBook} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          {error && <div style={{ color: "var(--error)", padding: "0.5rem", background: "rgba(239, 68, 68, 0.1)", borderRadius: "var(--radius-sm)" }}>{error}</div>}
          
          <div>
            <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: "500" }}>Pickup Location</label>
            <input
              type="text"
              value={pickup}
              onChange={(e) => setPickup(e.target.value)}
              placeholder="e.g. Tribhuvan International Airport"
              className="input"
              disabled={loading}
              required
            />
          </div>

          <div>
            <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: "500" }}>Drop Location</label>
            <input
              type="text"
              value={drop}
              onChange={(e) => setDrop(e.target.value)}
              placeholder="e.g. Thamel"
              className="input"
              disabled={loading}
              required
            />
          </div>

          <div>
            <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: "500" }}>Vehicle Type</label>
            <select
              value={vehicleType}
              onChange={(e) => setVehicleType(e.target.value)}
              className="input"
              disabled={loading}
              style={{ width: "100%", padding: "0.75rem 1rem", backgroundColor: "var(--surface)", color: "var(--text-main)", borderRadius: "var(--radius-md)", border: "1px solid var(--border)" }}
            >
              <option value="BIKE">Bike (1 Seat)</option>
              <option value="AUTO">Auto (3 Seats)</option>
              <option value="TAXI">Taxi (4 Seats)</option>
            </select>
          </div>

          <button type="submit" className="btn-primary" disabled={loading} style={{ marginTop: "1rem" }}>
            {loading ? "Booking..." : "Confirm Booking"}
          </button>
        </form>
      </div>
    </div>
  );
}
