"use client";

import { useState } from "react";
import Link from "next/link";
import AppShell from "@/components/AppShell";
import FlowPage from "@/components/FlowPage";
import LineItems, { blankLine, type CartLine } from "@/components/LineItems";
import useSession from "@/hooks/useSession";
import { bookingApi } from "@/lib/api";
import { inr, toFailure } from "@/lib/format";

interface PlacedOrder {
  id: string;
  orderNumber?: string;
  status?: string;
  totalAmount?: number;
  lines?: { product_name_snapshot?: string; quantity?: number; line_total?: number }[];
}

export default function FoodPage() {
  const { user, loading } = useSession();
  const [restaurantId, setRestaurantId] = useState("");
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [lines, setLines] = useState<CartLine[]>([blankLine(1)]);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  const [order, setOrder] = useState<PlacedOrder | null>(null);

  if (loading || !user) {
    return (
      <AppShell>
        <div className="nabin-skeleton" style={{ height: 260, borderRadius: 20 }} />
      </AppShell>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const filled = lines.filter((line) => line.name.trim() && line.qty > 0);
    if (!restaurantId.trim()) {
      setFailure("Enter the restaurant ID you are ordering from.");
      return;
    }
    if (!deliveryAddress.trim()) {
      setFailure("Enter a delivery address.");
      return;
    }
    if (filled.length === 0) {
      setFailure("Add at least one item with a quantity above zero.");
      return;
    }

    setBusy(true);
    setFailure("");
    setOrder(null);
    try {
      const res = await bookingApi.bookFood({
        customerId: user.id,
        restaurantId: restaurantId.trim(),
        deliveryAddress: deliveryAddress.trim(),
        items: filled.map((line) => ({ name: line.name.trim(), quantity: line.qty })),
      });
      if (res.data.success) {
        setOrder(res.data.job);
        setLines([blankLine(1)]);
      } else {
        setFailure(res.data.error || "Could not place the order.");
      }
    } catch (err) {
      setFailure(toFailure(err, "Could not reach the NABIN API on port 4000.").message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppShell>
      <FlowPage title="Order food" subtitle="Send an order straight to the restaurant kitchen.">
        <div className="nabin-notice">
          Menu browsing is not exposed by the platform yet, so item names must match the
          restaurant&rsquo;s catalog. Prices are read from that catalog server-side, never from this page.
        </div>

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
              <span className="nabin-cell-meta">Total</span>
              <span className="nabin-order__amount nabin-num">{inr(order.totalAmount)}</span>
            </div>
            <div className="nabin-list-row" style={{ borderBottom: "none" }}>
              <span className="nabin-cell-meta">Delivering to {deliveryAddress || "your address"}</span>
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

        <form onSubmit={handleSubmit} className="nabin-form nabin-card">
          <div>
            <label className="nabin-label" htmlFor="restaurant">
              Restaurant ID
            </label>
            <input
              id="restaurant"
              className="nabin-input"
              type="text"
              value={restaurantId}
              onChange={(e) => setRestaurantId(e.target.value)}
              placeholder="e.g. mcht_1"
              disabled={busy}
              required
            />
          </div>

          <div>
            <span className="nabin-label">Items</span>
            <LineItems lines={lines} onChange={setLines} disabled={busy} qtyLabel="quantity" />
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

          <button type="submit" className="nabin-btn nabin-btn--primary" disabled={busy}>
            {busy ? "Placing order…" : "Place order"}
          </button>
        </form>
      </FlowPage>
    </AppShell>
  );
}
