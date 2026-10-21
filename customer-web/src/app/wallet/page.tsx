"use client";

import AppShell from "@/components/AppShell";
import useSession from "@/hooks/useSession";
import { inr } from "@/lib/format";
import Link from "next/link";

export default function WalletPage() {
  const { user, loading: authLoading } = useSession();
  // walletBalance is the number the store put on this session's entity: 001_central_schema.sql declares
  // users.wallet_balance, database.js hydrates it onto the entity, and /api/auth/me sends that entity
  // whole apart from `rating`. Null means the backend never told this screen a balance — a demo session
  // has no durable account behind it. It has to stay null rather than become a zero, because inr() in
  // lib/format.ts falls its argument back to 0: an unread balance printed through inr() reads as ₹0.00.
  const balance = user?.walletBalance ?? null;

  return (
    <AppShell>
      <div className="nabin-container" style={{ paddingTop: 32, paddingBottom: 64 }}>
        {/* Breadcrumb & Header */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--ink-muted)", marginBottom: 8 }}>
            <Link href="/" style={{ color: "var(--brand)", textDecoration: "none" }}>Home</Link>
            <span>/</span>
            <span>Wallet & Balance</span>
          </div>
          <h1 style={{ fontSize: 28, fontWeight: 900, color: "var(--brand)", margin: 0 }}>
            NABIN Wallet
          </h1>
          <p style={{ margin: "4px 0 0", color: "var(--ink-muted)", fontSize: 14 }}>
            The balance on your account, as the server reports it.
          </p>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 24 }}>
          {/* Wallet Balance Card */}
          <div
            className="nabin-card"
            style={{
              background: "linear-gradient(135deg, #1A3BA2 0%, #142E80 100%)",
              color: "#FFFFFF",
              padding: 28,
              borderRadius: 16,
              boxShadow: "0 8px 24px rgba(26, 59, 162, 0.22)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", opacity: 0.85, fontSize: 13 }}>
              <span>AVAILABLE BALANCE</span>
              <span className="nabin-wordmark" style={{ color: "#FFFFFF", fontSize: 14 }}>NABIN PAY</span>
            </div>
            <div style={{ fontSize: 38, fontWeight: 900, margin: "16px 0 8px", letterSpacing: "-0.02em" }}>
              {authLoading ? "Checking…" : balance === null ? "Not available" : inr(balance)}
            </div>
            <div style={{ fontSize: 13, opacity: 0.9, marginBottom: 24, lineHeight: 1.4 }}>
              {!authLoading && balance === null
                ? "Your wallet balance is not shown while it cannot be read."
                : "This is the balance on the account your session is signed in to."}
            </div>

            <div
              style={{
                background: "rgba(255, 255, 255, 0.14)",
                border: "1px solid rgba(255, 255, 255, 0.28)",
                borderRadius: 10,
                padding: "10px 14px",
                fontSize: 13,
                lineHeight: 1.4,
              }}
            >
              Adding money to your wallet isn&#39;t available on this screen yet.
            </div>
          </div>

          {/* What this screen does with the number */}
          <div className="nabin-card" style={{ padding: 24, borderRadius: 16 }}>
            <h3 style={{ fontSize: 16, fontWeight: 800, margin: "0 0 16px", color: "var(--ink)" }}>
              About this balance
            </h3>

            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ padding: 14, border: "1px solid var(--divider)", borderRadius: 10 }}>
                <div style={{ fontWeight: 700, fontSize: 13, color: "var(--ink)" }}>
                  Read from your session, never written here
                </div>
                <div style={{ fontSize: 12, color: "var(--ink-muted)", marginTop: 4, lineHeight: 1.4 }}>
                  The figure comes from your account record on the server. This screen reads it and cannot
                  change it — a balance moves only when the ledger records the movement.
                </div>
              </div>

              <div style={{ padding: 14, border: "1px solid var(--divider)", borderRadius: 10 }}>
                <div style={{ fontWeight: 700, fontSize: 13, color: "var(--ink)" }}>
                  A balance that cannot be read is shown that way
                </div>
                <div style={{ fontSize: 12, color: "var(--ink-muted)", marginTop: 4, lineHeight: 1.4 }}>
                  A session with no account behind it has no balance to display, so this screen says so
                  instead of printing a number for it.
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Transaction history */}
        <div style={{ marginTop: 36 }}>
          <h2 style={{ fontSize: 20, fontWeight: 800, margin: "0 0 16px", color: "var(--ink)" }}>
            Transaction history
          </h2>

          <div className="nabin-card" style={{ padding: 20, borderRadius: 12 }}>
            <div style={{ fontSize: 13, color: "var(--ink-muted)", lineHeight: 1.5 }}>
              This screen has nothing to read your history from, so it lists no rows. Your bookings are on
              the{" "}<Link href="/orders" style={{ color: "var(--brand)", textDecoration: "none", fontWeight: 700 }}>Orders</Link>{" "}page.
              A list written here would not be your activity — it would be invented.
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
