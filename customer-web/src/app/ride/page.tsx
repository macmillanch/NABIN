"use client";

import { useState } from "react";
import Link from "next/link";
import AppShell from "@/components/AppShell";
import FlowPage from "@/components/FlowPage";
import useSession from "@/hooks/useSession";
import { bookingApi } from "@/lib/api";
import { dateTime, inr, toFailure } from "@/lib/format";

interface RideJob {
  id: string;
  status: string;
  fare?: number;
  distance?: string;
  duration?: string;
  vehicleType?: string;
  createdAt?: string;
  pickup?: { address?: string };
  drop?: { address?: string };
}

const VEHICLES = [
  { value: "BIKE", label: "Bike", meta: "1 seat · fastest" },
  { value: "AUTO", label: "Auto", meta: "3 seats" },
  { value: "TAXI", label: "Taxi", meta: "4 seats · AC" },
] as const;

const SPLASH: Record<string, string> = {
  SEARCHING: "Looking for a driver nearby…",
  ASSIGNED: "A driver has been assigned.",
  ACCEPTED: "Your driver accepted the trip.",
  ARRIVED: "Your driver has reached the pickup point.",
  STARTED: "Trip in progress.",
  COMPLETED: "Trip completed. Thanks for riding with NABIN.",
};

export default function RidePage() {
  const { user, loading } = useSession();
  const [pickup, setPickup] = useState("");
  const [drop, setDrop] = useState("");
  const [vehicleType, setVehicleType] = useState<string>("TAXI");
  const [promoCode, setPromoCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string>("");
  const [job, setJob] = useState<RideJob | null>(null);

  if (loading || !user) {
    return (
      <AppShell>
        <div className="nabin-skeleton" style={{ height: 260, borderRadius: 20 }} />
      </AppShell>
    );
  }

  const unverified = user.identityStatus && user.identityStatus !== "VERIFIED";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pickup.trim() || !drop.trim()) {
      setFailure("Enter both a pickup and a drop location.");
      return;
    }
    setBusy(true);
    setFailure("");
    setJob(null);
    try {
      const res = await bookingApi.bookRide({
        customerId: user.id,
        vehicleType,
        pickup: { address: pickup.trim() },
        drop: { address: drop.trim() },
        promoCode: promoCode.trim() || undefined,
      });
      if (res.data.success) {
        setJob(res.data.job);
        setPickup("");
        setDrop("");
        setPromoCode("");
      } else {
        setFailure(res.data.error || "Could not create the ride request.");
      }
    } catch (err) {
      setFailure(toFailure(err, "Could not reach the NABIN API on port 4000.").message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppShell>
      <FlowPage title="Book a ride" subtitle="Choose a vehicle and we broadcast your request to nearby drivers.">
        {unverified && (
          <div className="nabin-notice" role="status">
            Identity verification is pending on this account, so bookings are blocked.{" "}
            <Link href="/profile" className="nabin-alert__action" style={{ margin: 0 }}>
              View status
            </Link>
          </div>
        )}

        {job && (
          <div className="nabin-alert nabin-alert--success" role="status">
            <h2>Ride requested</h2>
            <div className="nabin-list-row">
              <span className="nabin-cell-meta">Job ID</span>
              <span className="nabin-mono">{job.id}</span>
            </div>
            <div className="nabin-list-row">
              <span className="nabin-cell-meta">Route</span>
              <span style={{ fontWeight: 700, textAlign: "right" }}>
                {job.pickup?.address ?? pickup} &rarr; {job.drop?.address ?? drop}
              </span>
            </div>
            {(job.distance || job.duration) && (
              <div className="nabin-list-row">
                <span className="nabin-cell-meta">Distance</span>
                <span style={{ fontWeight: 700 }}>
                  {[job.distance, job.duration].filter(Boolean).join(" · ")}
                </span>
              </div>
            )}
            <div className="nabin-list-row">
              <span className="nabin-cell-meta">Estimated fare</span>
              <span className="nabin-order__amount nabin-num">{inr(job.fare)}</span>
            </div>
            <div className="nabin-list-row" style={{ borderBottom: "none" }}>
              <span className="nabin-cell-meta">{dateTime(job.createdAt) || "Just now"}</span>
              <span className="nabin-badge nabin-badge--warning">{SPLASH[job.status] ?? job.status}</span>
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

        <form onSubmit={handleSubmit} className="nabin-form nabin-card">
          <div>
            <span className="nabin-label">Vehicle</span>
            <div className="nabin-segment">
              {VEHICLES.map((option) => (
                <div key={option.value} className="nabin-segment__option">
                  <input
                    id={`vehicle-${option.value}`}
                    type="radio"
                    name="vehicleType"
                    value={option.value}
                    checked={vehicleType === option.value}
                    onChange={() => setVehicleType(option.value)}
                    disabled={busy}
                  />
                  <label className="nabin-segment__label" htmlFor={`vehicle-${option.value}`}>
                    <span className="nabin-segment__name">{option.label}</span>
                    <span className="nabin-segment__meta">{option.meta}</span>
                  </label>
                </div>
              ))}
            </div>
          </div>

          <div>
            <label className="nabin-label" htmlFor="pickup">
              Pickup
            </label>
            <input
              id="pickup"
              className="nabin-input"
              type="text"
              value={pickup}
              onChange={(e) => setPickup(e.target.value)}
              placeholder="e.g. Civil Lines Metro Gate 2, Delhi"
              disabled={busy}
              required
            />
          </div>

          <div>
            <label className="nabin-label" htmlFor="drop">
              Drop
            </label>
            <input
              id="drop"
              className="nabin-input"
              type="text"
              value={drop}
              onChange={(e) => setDrop(e.target.value)}
              placeholder="e.g. Connaught Place Inner Circle, Block B"
              disabled={busy}
              required
            />
          </div>

          <div>
            <label className="nabin-label" htmlFor="promo">
              Promo code <span className="nabin-segment__meta">(optional)</span>
            </label>
            <input
              id="promo"
              className="nabin-input"
              type="text"
              value={promoCode}
              onChange={(e) => setPromoCode(e.target.value.toUpperCase())}
              placeholder="e.g. NABIN50"
              disabled={busy}
            />
          </div>

          <button type="submit" className="nabin-btn nabin-btn--primary" disabled={busy || Boolean(unverified)}>
            {busy ? "Requesting…" : "Request ride"}
          </button>
          <p className="nabin-cell-meta" style={{ textAlign: "center" }}>
            Fare is estimated by the pricing engine at booking time, not by this page.
          </p>
        </form>
      </FlowPage>
    </AppShell>
  );
}
