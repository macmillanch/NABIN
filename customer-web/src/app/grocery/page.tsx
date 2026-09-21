"use client";

import { useState } from "react";
import Link from "next/link";
import AppShell from "@/components/AppShell";
import FlowPage from "@/components/FlowPage";
import LineItems, { blankLine, type CartLine } from "@/components/LineItems";
import useSession from "@/hooks/useSession";
import { bookingApi } from "@/lib/api";
import { inr, toFailure } from "@/lib/format";

interface GroceryOrder {
  id: string;
  order_number?: string;
  status?: string;
  checkoutId?: string;
  finalTotal?: number;
  deliveryAddress?: string;
  items?: { productName?: string; quantity?: number; unit?: string; finalItemAmount?: number }[];
}

const PAYMENT = [
  { value: "CASH", label: "Cash on delivery", meta: "Pay the delivery partner" },
  { value: "WALLET", label: "NABIN Wallet", meta: "Debited at checkout" },
] as const;

export default function GroceryPage() {
  const { user, loading } = useSession();
  const [storeId, setStoreId] = useState("");
  const [lines, setLines] = useState<CartLine[]>([blankLine(1)]);
  const [paymentMethod, setPaymentMethod] = useState<string>("CASH");
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [instructions, setInstructions] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  const [order, setOrder] = useState<GroceryOrder | null>(null);

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
    if (!storeId.trim()) {
      setFailure("Enter the store ID. Dark stores are not supported.");
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
      const res = await bookingApi.checkoutGrocery({
        merchantId: storeId.trim(),
        paymentMethod,
        deliveryAddress: deliveryAddress.trim() || undefined,
        deliveryInstructions: instructions.trim() || undefined,
        items: filled.map((line) => ({ name: line.name.trim(), quantity: line.qty })),
      });
      if (res.data.success) {
        setOrder(res.data.order);
        setLines([blankLine(1)]);
        setInstructions("");
      } else {
        setFailure(res.data.error || "Checkout failed.");
      }
    } catch (err) {
      setFailure(toFailure(err, "Could not reach the NABIN API on port 4000.").message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppShell>
      <FlowPage title="Grocery checkout" subtitle="Order from an independent NABIN grocery partner.">
        <div className="nabin-notice">
          Product browsing is not exposed by the platform yet, so item names must match the
          store&rsquo;s inventory. Quantities follow the unit the store lists — kilograms or pieces.
        </div>

        {order && (
          <div className="nabin-alert nabin-alert--success" role="status">
            <h2>Checkout confirmed</h2>
            <div className="nabin-list-row">
              <span className="nabin-cell-meta">Order</span>
              <span className="nabin-mono">{order.order_number || order.id}</span>
            </div>
            {(order.items ?? []).map((item, index) => (
              <div key={index} className="nabin-list-row">
                <span style={{ fontWeight: 700 }}>
                  {item.quantity}
                  {item.unit === "kg" ? " kg" : ` ${item.unit ?? "pc"}`} {item.productName}
                </span>
                <span className="nabin-num">{inr(item.finalItemAmount)}</span>
              </div>
            ))}
            <div className="nabin-list-row">
              <span className="nabin-cell-meta">Total payable</span>
              <span className="nabin-order__amount nabin-num">{inr(order.finalTotal)}</span>
            </div>
            <div className="nabin-list-row" style={{ borderBottom: "none" }}>
              <span className="nabin-cell-meta">
                {paymentMethod === "CASH" ? "Cash on delivery" : "Paid from wallet"}
                {order.deliveryAddress ? ` · ${order.deliveryAddress}` : ""}
              </span>
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
            <label className="nabin-label" htmlFor="store">
              Store ID
            </label>
            <input
              id="store"
              className="nabin-input"
              type="text"
              value={storeId}
              onChange={(e) => setStoreId(e.target.value)}
              placeholder="e.g. mcht_1"
              disabled={busy}
              required
            />
          </div>

          <div>
            <span className="nabin-label">Items</span>
            <LineItems
              lines={lines}
              onChange={setLines}
              disabled={busy}
              placeholder="e.g. Toor Dal"
              qtyLabel="quantity"
            />
          </div>

          <div>
            <span className="nabin-label">Payment</span>
            <div className="nabin-segment">
              {PAYMENT.map((option) => (
                <div key={option.value} className="nabin-segment__option">
                  <input
                    id={`pay-${option.value}`}
                    type="radio"
                    name="paymentMethod"
                    value={option.value}
                    checked={paymentMethod === option.value}
                    onChange={() => setPaymentMethod(option.value)}
                    disabled={busy}
                  />
                  <label className="nabin-segment__label" htmlFor={`pay-${option.value}`}>
                    <span className="nabin-segment__name">{option.label}</span>
                    <span className="nabin-segment__meta">{option.meta}</span>
                  </label>
                </div>
              ))}
            </div>
          </div>

          <div>
            <label className="nabin-label" htmlFor="address">
              Delivery address <span className="nabin-segment__meta">(optional)</span>
            </label>
            <input
              id="address"
              className="nabin-input"
              type="text"
              value={deliveryAddress}
              onChange={(e) => setDeliveryAddress(e.target.value)}
              placeholder="e.g. Flat 402, Civil Lines, Delhi"
              disabled={busy}
            />
          </div>

          <div>
            <label className="nabin-label" htmlFor="instructions">
              Instructions for the store <span className="nabin-segment__meta">(optional)</span>
            </label>
            <input
              id="instructions"
              className="nabin-input"
              type="text"
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder="e.g. Leave with the security desk"
              disabled={busy}
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
