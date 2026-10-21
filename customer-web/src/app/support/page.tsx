"use client";

import { useState } from "react";
import AppShell from "@/components/AppShell";
import useSession from "@/hooks/useSession";
import Link from "next/link";

interface SupportTicket {
  id: string;
  subject: string;
  category: "RIDE" | "FOOD" | "GROCERY" | "PARCEL" | "PAYMENT" | "GENERAL";
  status: "OPEN" | "IN_PROGRESS" | "RESOLVED";
  createdAt: string;
  lastMessage: string;
}

const DEMO_TICKETS: SupportTicket[] = [
  {
    id: "TCK-8812",
    subject: "Driver arrived at alternate gate for parcel pickup [Demo Data]",
    category: "PARCEL",
    status: "RESOLVED",
    createdAt: new Date(Date.now() - 48 * 3600 * 1000).toISOString(),
    lastMessage: "Issue resolved. Driver coordinates corrected for future jobs.",
  },
  {
    id: "TCK-9041",
    subject: "Duplicate wallet charge during UPI gateway timeout [Demo Data]",
    category: "PAYMENT",
    status: "IN_PROGRESS",
    createdAt: new Date(Date.now() - 5 * 3600 * 1000).toISOString(),
    lastMessage: "Our finance desk is verifying with the acquiring gateway.",
  },
];

const FAQS = [
  {
    q: "How do I cancel or modify an ongoing Ride booking?",
    a: "You can cancel a ride before the driver arrives by tapping 'Cancel Ride' on the live trip tracker. Free cancellation is permitted within 2 minutes of driver assignment.",
  },
  {
    q: "What should I do if a grocery product is missing or damaged?",
    a: "Take a photo of the item and receipt, then submit a dispute under 'Orders -> Dispute Item'. Refunds are credited back to your NABIN Wallet instantly.",
  },
  {
    q: "How does Express Parcel OTP verification work?",
    a: "When your driver arrives at the recipient location, an encrypted 4-digit PIN is sent to the recipient. The driver enters the PIN to successfully complete delivery.",
  },
  {
    q: "How fast are wallet top-ups processed?",
    a: "Wallet top-ups in this preview environment are simulated immediately in local memory. In production, processing times depend on the configured payment gateway.",
  },
];

export default function SupportPage() {
  const { user } = useSession();
  const [tickets, setTickets] = useState<SupportTicket[]>(DEMO_TICKETS);
  const [subject, setSubject] = useState("");
  const [category, setCategory] = useState<SupportTicket["category"]>("GENERAL");
  const [message, setMessage] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [submittedNotice, setSubmittedNotice] = useState<string | null>(null);

  const handleSubmitTicket = (e: React.FormEvent) => {
    e.preventDefault();
    if (!subject.trim() || !message.trim()) return;

    const newTicket: SupportTicket = {
      id: `TCK-${Math.floor(1000 + Math.random() * 9000)}`,
      subject: subject.trim(),
      category,
      status: "OPEN",
      createdAt: new Date().toISOString(),
      lastMessage: message.trim(),
    };

    setTickets((prev) => [newTicket, ...prev]);
    setSubject("");
    setMessage("");
    setSubmittedNotice(`Support Ticket #${newTicket.id} created! Our customer care desk responds within 15 minutes.`);
  };

  const filteredFaqs = FAQS.filter(
    (f) =>
      f.q.toLowerCase().includes(searchQuery.toLowerCase()) ||
      f.a.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <AppShell>
      <div className="nabin-container" style={{ paddingTop: 32, paddingBottom: 64 }}>
        {/* Header Breadcrumb */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--ink-muted)", marginBottom: 8 }}>
            <Link href="/" style={{ color: "var(--brand)", textDecoration: "none" }}>Home</Link>
            <span>/</span>
            <span>Customer Help & Dispute Desk</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
            <div>
              <h1 style={{ fontSize: 28, fontWeight: 900, color: "var(--brand)", margin: 0 }}>
                Help & Customer Support
              </h1>
              <p style={{ margin: "4px 0 0", color: "var(--ink-muted)", fontSize: 14 }}>
                Instant resolution for rides, restaurant orders, grocery deliveries, and parcel logistics.
              </p>
            </div>
            <span
              style={{
                background: "var(--brand-tint)",
                color: "var(--brand)",
                padding: "4px 12px",
                borderRadius: 999,
                fontSize: 12,
                fontWeight: 700,
              }}
            >
              24/7 Priority Support
            </span>
          </div>
        </div>

        {submittedNotice && (
          <div
            style={{
              background: "#F0FDF4",
              border: "1px solid #86EFAC",
              color: "#166534",
              padding: "12px 16px",
              borderRadius: 8,
              fontSize: 13,
              marginBottom: 20,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <span>{submittedNotice}</span>
            <button
              onClick={() => setSubmittedNotice(null)}
              style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", fontWeight: "bold" }}
            >
              ✕
            </button>
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 24 }}>
          {/* Submit a New Ticket Form */}
          <div className="nabin-card" style={{ padding: 24, borderRadius: 16 }}>
            <h2 style={{ fontSize: 18, fontWeight: 800, margin: "0 0 16px", color: "var(--ink)" }}>
              Open a Support Ticket
            </h2>

            <form onSubmit={handleSubmitTicket} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div>
                <label style={{ fontSize: 12, fontWeight: 700, color: "var(--ink-muted)", display: "block", marginBottom: 4 }}>
                  SERVICE CATEGORY
                </label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value as SupportTicket["category"])}
                  style={{
                    width: "100%",
                    padding: "9px 12px",
                    borderRadius: 8,
                    border: "1px solid var(--divider)",
                    fontSize: 13,
                    background: "#FFFFFF",
                  }}
                >
                  <option value="GENERAL">General Support & Account</option>
                  <option value="RIDE">NABIN Ride (Trip, Fare, Driver)</option>
                  <option value="FOOD">NABIN Food (Order Delay, Missing Items)</option>
                  <option value="GROCERY">NABIN Grocery (Stock, Damaged Product)</option>
                  <option value="PARCEL">NABIN Parcel (Tracking, Delivery PIN)</option>
                  <option value="PAYMENT">Wallet & Payment Dispute</option>
                </select>
              </div>

              <div>
                <label style={{ fontSize: 12, fontWeight: 700, color: "var(--ink-muted)", display: "block", marginBottom: 4 }}>
                  SUBJECT
                </label>
                <input
                  type="text"
                  placeholder="e.g. Order delivered to wrong doorstep"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  required
                  style={{
                    width: "100%",
                    padding: "9px 12px",
                    borderRadius: 8,
                    border: "1px solid var(--divider)",
                    fontSize: 13,
                    boxSizing: "border-box",
                  }}
                />
              </div>

              <div>
                <label style={{ fontSize: 12, fontWeight: 700, color: "var(--ink-muted)", display: "block", marginBottom: 4 }}>
                  DETAILED MESSAGE
                </label>
                <textarea
                  rows={4}
                  placeholder="Describe your issue with order reference number or trip ID..."
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  required
                  style={{
                    width: "100%",
                    padding: "9px 12px",
                    borderRadius: 8,
                    border: "1px solid var(--divider)",
                    fontSize: 13,
                    boxSizing: "border-box",
                  }}
                />
              </div>

              <button
                type="submit"
                className="nabin-btn nabin-btn--primary"
                style={{ width: "100%", padding: "12px", fontWeight: 800, fontSize: 14 }}
              >
                Submit Ticket
              </button>
            </form>
          </div>

          {/* Active Tickets List */}
          <div className="nabin-card" style={{ padding: 24, borderRadius: 16 }}>
            <h2 style={{ fontSize: 18, fontWeight: 800, margin: "0 0 16px", color: "var(--ink)" }}>
              Your Support Inquiries ({tickets.length})
            </h2>

            <div style={{ display: "flex", flexDirection: "column", gap: 12, maxHeight: 380, overflowY: "auto" }}>
              {tickets.map((t) => (
                <div
                  key={t.id}
                  style={{
                    padding: 14,
                    borderRadius: 10,
                    border: "1px solid var(--divider)",
                    background: "var(--surface-muted)",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                    <span style={{ fontSize: 11, fontWeight: 800, color: "var(--brand)" }}>{t.id} · {t.category}</span>
                    <span
                      style={{
                        fontSize: 10.5,
                        fontWeight: 700,
                        padding: "2px 8px",
                        borderRadius: 999,
                        background:
                          t.status === "RESOLVED"
                            ? "#DCFCE7"
                            : t.status === "IN_PROGRESS"
                            ? "#FEF3C7"
                            : "#EFF6FF",
                        color:
                          t.status === "RESOLVED"
                            ? "#166534"
                            : t.status === "IN_PROGRESS"
                            ? "#92400E"
                            : "#1D4ED8",
                      }}
                    >
                      {t.status.replace("_", " ")}
                    </span>
                  </div>
                  <div style={{ fontWeight: 700, fontSize: 13, color: "var(--ink)" }}>{t.subject}</div>
                  <div style={{ fontSize: 12, color: "var(--ink-muted)", marginTop: 4, lineHeight: 1.4 }}>
                    {t.lastMessage}
                  </div>
                </div>
              ))}
            </div>

            <div style={{ marginTop: 20, padding: 14, background: "var(--surface-muted)", border: "1px dashed var(--divider)", borderRadius: 8, fontSize: 12, color: "var(--ink-muted)", lineHeight: 1.4 }}>
              ⚠️ Emergency Assistance Notice: Direct telephone emergency dispatch integration is currently unconfigured. For immediate emergency safety assistance, please reach out directly to local authorities and emergency services.
            </div>
          </div>
        </div>

        {/* Knowledge Base / FAQ Section */}
        <div style={{ marginTop: 40 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12, marginBottom: 16 }}>
            <h2 style={{ fontSize: 20, fontWeight: 800, color: "var(--ink)", margin: 0 }}>
              Frequently Asked Questions
            </h2>
            <input
              type="text"
              placeholder="Search help articles..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                padding: "8px 14px",
                borderRadius: 8,
                border: "1px solid var(--divider)",
                fontSize: 13,
                width: 240,
              }}
            />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 16 }}>
            {filteredFaqs.map((faq, i) => (
              <div key={i} className="nabin-card" style={{ padding: 18, borderRadius: 12 }}>
                <div style={{ fontWeight: 800, fontSize: 14, color: "var(--brand)", marginBottom: 6 }}>
                  {faq.q}
                </div>
                <div style={{ fontSize: 13, color: "var(--ink-muted)", lineHeight: 1.5 }}>
                  {faq.a}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
