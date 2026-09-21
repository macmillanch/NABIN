"use client";

import Link from "next/link";
import AppShell from "@/components/AppShell";
import FlowPage from "@/components/FlowPage";
import useSession from "@/hooks/useSession";

const IDENTITY: Record<string, { label: string; tone: string; note: string }> = {
  VERIFIED: { label: "Verified", tone: "success", note: "You can book every NABIN service." },
  IDENTITY_VERIFICATION_PENDING: {
    label: "Pending review",
    tone: "warning",
    note: "Bookings stay blocked until an admin approves your documents.",
  },
  UNDER_REVIEW: {
    label: "Under review",
    tone: "warning",
    note: "An admin is checking your resubmitted documents.",
  },
  RESUBMISSION_REQUIRED: {
    label: "Resubmit documents",
    tone: "danger",
    note: "Your last submission could not be accepted. Upload it again from the mobile app.",
  },
  REJECTED: {
    label: "Rejected",
    tone: "danger",
    note: "Contact NABIN support to restart identity verification.",
  },
};

export default function ProfilePage() {
  const { user, loading, logout } = useSession();

  if (loading || !user) {
    return (
      <AppShell>
        <div className="nabin-skeleton" style={{ height: 220, borderRadius: 20 }} />
      </AppShell>
    );
  }

  const identity = IDENTITY[user.identityStatus ?? ""] ?? {
    label: user.identityStatus ?? "Unknown",
    tone: "neutral",
    note: "Identity status is unavailable for this account.",
  };
  const display = user.name || user.phone;

  return (
    <AppShell>
      <FlowPage title="Profile" subtitle="Account details NABIN keeps on file for you.">
        <section className="nabin-card nabin-section">
          <div className="nabin-row" style={{ gap: "var(--space-md)" }}>
            <span className="nabin-avatar" style={{ width: 56, height: 56, fontSize: 20 }} aria-hidden="true">
              {display.slice(0, 1).toUpperCase()}
            </span>
            <div style={{ minWidth: 0 }}>
              <h2 style={{ fontSize: 18, fontWeight: 900 }}>{display}</h2>
              <p className="nabin-cell-meta">{user.phone}</p>
            </div>
            <span className={`nabin-badge nabin-badge--${identity.tone}`} style={{ marginInlineStart: "auto" }}>
              {identity.label}
            </span>
          </div>
          <p className="nabin-cell-meta" style={{ marginTop: "var(--space-sm)" }}>
            {identity.note}
          </p>
        </section>

        <section className="nabin-card nabin-section">
          <h2 className="nabin-section-title" style={{ marginTop: 0 }}>
            Account details
          </h2>
          <div className="nabin-list-row">
            <span className="nabin-cell-meta">Phone number</span>
            <span style={{ fontWeight: 700 }}>{user.phone}</span>
          </div>
          <div className="nabin-list-row">
            <span className="nabin-cell-meta">Customer ID</span>
            <span className="nabin-mono">{user.id}</span>
          </div>
          <div className="nabin-list-row" style={{ borderBottom: "none" }}>
            <span className="nabin-cell-meta">Role</span>
            <span style={{ fontWeight: 700, textTransform: "capitalize" }}>{user.role}</span>
          </div>
        </section>

        <div className="nabin-row" style={{ gap: "var(--space-sm)" }}>
          <Link href="/orders" className="nabin-btn nabin-btn--ghost" style={{ flex: 1 }}>
            My orders
          </Link>
          <button
            onClick={logout}
            className="nabin-btn nabin-btn--danger"
            style={{ flex: 1 }}
          >
            Log out
          </button>
        </div>
      </FlowPage>
    </AppShell>
  );
}
