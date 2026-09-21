"use client";

import { useState } from "react";
import Link from "next/link";
import AppShell from "@/components/AppShell";
import FlowPage from "@/components/FlowPage";
import useSession from "@/hooks/useSession";
import { bookingApi } from "@/lib/api";
import { inr, toFailure } from "@/lib/format";

interface ParcelJob {
  id: string;
  status: string;
  fare?: number;
  distance?: string;
  duration?: string;
  deliveryOtp?: string;
  pickup?: { address?: string };
  drop?: { address?: string };
}

export default function ParcelPage() {
  const { user, loading } = useSession();
  const [pickup, setPickup] = useState("");
  const [senderName, setSenderName] = useState("");
  const [drop, setDrop] = useState("");
  const [recipientName, setRecipientName] = useState("");
  const [recipientPhone, setRecipientPhone] = useState("");
  const [contents, setContents] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  const [job, setJob] = useState<ParcelJob | null>(null);

  if (loading || !user) {
    return (
      <AppShell>
        <div className="nabin-skeleton" style={{ height: 260, borderRadius: 20 }} />
      </AppShell>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pickup.trim() || !drop.trim()) {
      setFailure("Enter both the pickup and the drop address.");
      return;
    }
    if (!recipientName.trim() || !recipientPhone.trim()) {
      setFailure("The delivery partner needs a recipient name and phone number.");
      return;
    }

    setBusy(true);
    setFailure("");
    setJob(null);
    try {
      const res = await bookingApi.bookParcel({
        customerId: user.id,
        senderDetails: {
          address: pickup.trim(),
          name: senderName.trim() || user.name || user.phone,
          phone: user.phone,
        },
        recipientDetails: {
          address: drop.trim(),
          name: recipientName.trim(),
          phone: recipientPhone.trim(),
        },
        contents: contents.trim() || undefined,
      });
      if (res.data.success) {
        setJob(res.data.job);
        setPickup("");
        setDrop("");
        setContents("");
      } else {
        setFailure(res.data.error || "Could not book the parcel pickup.");
      }
    } catch (err) {
      setFailure(toFailure(err, "Could not reach the NABIN API on port 4000.").message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppShell>
      <FlowPage title="Send a parcel" subtitle="Courier pickup from your door, handed over with a one-time code.">
        {job && (
          <div className="nabin-alert nabin-alert--success" role="status">
            <h2>Parcel booked</h2>
            <div className="nabin-list-row">
              <span className="nabin-cell-meta">Job ID</span>
              <span className="nabin-mono">{job.id}</span>
            </div>
            <div className="nabin-list-row">
              <span className="nabin-cell-meta">Route</span>
              <span style={{ fontWeight: 700, textAlign: "right" }}>
                {job.pickup?.address} &rarr; {job.drop?.address}
              </span>
            </div>
            {(job.distance || job.duration) && (
              <div className="nabin-list-row">
                <span className="nabin-cell-meta">Distance</span>
                <span style={{ fontWeight: 700 }}>{[job.distance, job.duration].filter(Boolean).join(" · ")}</span>
              </div>
            )}
            <div className="nabin-list-row">
              <span className="nabin-cell-meta">Fare</span>
              <span className="nabin-order__amount nabin-num">{inr(job.fare)}</span>
            </div>
            {job.deliveryOtp && (
              <div className="nabin-list-row" style={{ borderBottom: "none" }}>
                <span className="nabin-cell-meta">Handover code for the recipient</span>
                <span className="nabin-mono nabin-num">{job.deliveryOtp}</span>
              </div>
            )}
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
          <h2 className="nabin-section-title" style={{ margin: 0 }}>
            Picked up from
          </h2>
          <div>
            <label className="nabin-label" htmlFor="pickup">
              Pickup address
            </label>
            <input
              id="pickup"
              className="nabin-input"
              type="text"
              value={pickup}
              onChange={(e) => setPickup(e.target.value)}
              placeholder="e.g. Kamla Nagar Market, Block C, Delhi"
              disabled={busy}
              required
            />
          </div>
          <div>
            <label className="nabin-label" htmlFor="sender">
              Sender name <span className="nabin-segment__meta">(optional)</span>
            </label>
            <input
              id="sender"
              className="nabin-input"
              type="text"
              value={senderName}
              onChange={(e) => setSenderName(e.target.value)}
              placeholder={user.name || user.phone}
              disabled={busy}
            />
          </div>

          <h2 className="nabin-section-title" style={{ margin: "var(--space-sm) 0 0" }}>
            Delivering to
          </h2>
          <div>
            <label className="nabin-label" htmlFor="drop">
              Drop address
            </label>
            <input
              id="drop"
              className="nabin-input"
              type="text"
              value={drop}
              onChange={(e) => setDrop(e.target.value)}
              placeholder="e.g. Karol Bagh Electronics Hub, Delhi"
              disabled={busy}
              required
            />
          </div>
          <div className="nabin-row" style={{ alignItems: "flex-start" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <label className="nabin-label" htmlFor="recipient">
                Recipient name
              </label>
              <input
                id="recipient"
                className="nabin-input"
                type="text"
                value={recipientName}
                onChange={(e) => setRecipientName(e.target.value)}
                placeholder="e.g. Ananya Verma"
                disabled={busy}
                required
              />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <label className="nabin-label" htmlFor="recipient-phone">
                Recipient phone
              </label>
              <input
                id="recipient-phone"
                className="nabin-input"
                type="tel"
                value={recipientPhone}
                onChange={(e) => setRecipientPhone(e.target.value)}
                placeholder="+91 98xxx xxxxx"
                disabled={busy}
                required
              />
            </div>
          </div>
          <div>
            <label className="nabin-label" htmlFor="contents">
              What is inside <span className="nabin-segment__meta">(optional)</span>
            </label>
            <input
              id="contents"
              className="nabin-input"
              type="text"
              value={contents}
              onChange={(e) => setContents(e.target.value)}
              placeholder="e.g. Documents, no fragile items"
              disabled={busy}
            />
          </div>

          <button type="submit" className="nabin-btn nabin-btn--primary" disabled={busy}>
            {busy ? "Booking…" : "Book pickup"}
          </button>
        </form>
      </FlowPage>
    </AppShell>
  );
}
