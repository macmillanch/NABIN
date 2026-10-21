"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import AppShell from "@/components/AppShell";
import { useAuth } from "@/context/AuthContext";
import { servicesApi } from "@/lib/api";

interface ServiceInfo {
  id: string;
  name: string;
  description: string;
  status: "ACTIVE" | "PAUSED" | "DEGRADED";
  broadcastNotice: string | null;
}

const SERVICE_ORDER = ["rides", "food", "grocery", "parcel"] as const;

const SERVICE_META: Record<string, { href: string; label: string; blurb: string; accent: string; icon: string; tag: string }> = {
  rides: { href: "/ride", label: "Ride", blurb: "Bike, auto and cab trips with live driver tracking.", accent: "var(--ride-blue)", icon: "🚕", tag: "Live GPS Track" },
  food: { href: "/food", label: "Food", blurb: "Order from nearby restaurants and follow preparation.", accent: "var(--food-orange)", icon: "🍲", tag: "Direct Kitchen KDS" },
  grocery: { href: "/grocery", label: "Grocery", blurb: "Daily staples packed by a nearby store.", accent: "var(--grocery-green)", icon: "🛒", tag: "Quick Commerce" },
  parcel: { href: "/parcel", label: "Parcel", blurb: "Send a package across the city with proof of delivery.", accent: "var(--parcel-teal)", icon: "📦", tag: "Secure OTP Delivery" },
};

const DEMO_SERVICES: ServiceInfo[] = [
  {
    id: "rides",
    name: "Rides",
    description: "Bike, auto and cab trips with live driver tracking.",
    status: "ACTIVE",
    broadcastNotice: null,
  },
  {
    id: "food",
    name: "Food",
    description: "Order from nearby restaurants and follow preparation.",
    status: "ACTIVE",
    broadcastNotice: null,
  },
  {
    id: "grocery",
    name: "Grocery",
    description: "Daily staples packed by a nearby store.",
    status: "ACTIVE",
    broadcastNotice: null,
  },
  {
    id: "parcel",
    name: "Parcel",
    description: "Send a package across the city with proof of delivery.",
    status: "ACTIVE",
    broadcastNotice: null,
  },
];

export default function DashboardPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const [services, setServices] = useState<ServiceInfo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isDemoFallback, setIsDemoFallback] = useState(false);

  useEffect(() => {
    if (!authLoading && !user) {
      router.push("/login");
    }
  }, [user, authLoading, router]);

  useEffect(() => {
    if (!user) return;
    const fetchServices = async () => {
      try {
        const res = await servicesApi.getStatus();
        if (res.data.success && Array.isArray(res.data.services) && res.data.services.length > 0) {
          const core = (res.data.services as ServiceInfo[]).filter((s) =>
            (SERVICE_ORDER as readonly string[]).includes(s.id),
          );
          core.sort((a, b) => SERVICE_ORDER.indexOf(a.id as (typeof SERVICE_ORDER)[number]) - SERVICE_ORDER.indexOf(b.id as (typeof SERVICE_ORDER)[number]));
          setServices(core);
          setIsDemoFallback(false);
          setError(null);
        } else {
          setServices(DEMO_SERVICES);
          setIsDemoFallback(true);
          setError(null);
        }
      } catch {
        setServices(DEMO_SERVICES);
        setIsDemoFallback(true);
        setError(null);
      } finally {
        setIsLoading(false);
      }
    };
    fetchServices();
  }, [user]);

  if (authLoading || !user) {
    return (
      <AppShell>
        <div className="nabin-stack">
          <div className="nabin-skeleton" style={{ height: 120, borderRadius: 28 }} />
          <div className="nabin-grid">
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="nabin-skeleton" style={{ height: 168, borderRadius: 20 }} />
            ))}
          </div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <section className="nabin-hero">
        <p style={{ opacity: 0.85, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", fontSize: 12 }}>
          Signed in as {user.phone}
        </p>
        <h1>What are we moving today?</h1>
        <p>One account for rides, food, grocery and parcels — priced and tracked by NABIN.</p>
      </section>

      {error && (
        <div className="nabin-alert nabin-alert--danger" role="alert" style={{ marginTop: "var(--space-lg)" }}>
          <span>{error}</span>
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-md)' }}>
        <h2 className="nabin-section-title" style={{ margin: 0 }}>Services</h2>
        {isDemoFallback && (
          <span className="nabin-badge nabin-badge--neutral">
            Demo Preview (Offline)
          </span>
        )}
      </div>
      {isLoading ? (
        <div className="nabin-grid">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="nabin-skeleton" style={{ height: 168, borderRadius: 20 }} />
          ))}
        </div>
      ) : (
        <div className="nabin-grid">
          {services.map((service) => {
            const meta = SERVICE_META[service.id];
            const isAvailable = service.status === "ACTIVE" || service.status === "DEGRADED";
            return (
              <article
                key={service.id}
                className={`nabin-card ${isAvailable ? "nabin-card--interactive" : ""}`}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "space-between",
                  borderTop: `4px solid ${meta?.accent || "var(--brand)"}`,
                  position: "relative",
                }}
              >
                <div>
                  <div className="nabin-card__header" style={{ marginBottom: "var(--space-sm)" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <div
                        style={{
                          width: 44,
                          height: 44,
                          borderRadius: 12,
                          background: `color-mix(in srgb, ${meta?.accent || "var(--brand)"} 12%, transparent)`,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: 22,
                        }}
                      >
                        {meta?.icon || "✨"}
                      </div>
                      <div>
                        <h3 style={{ fontSize: 18, fontWeight: 800, margin: 0 }}>{meta?.label ?? service.name}</h3>
                        {meta?.tag && (
                          <span style={{ fontSize: 11, fontWeight: 700, color: "var(--ink-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                            {meta.tag}
                          </span>
                        )}
                      </div>
                    </div>
                    <span
                      className={`nabin-badge ${
                        service.status === "ACTIVE"
                          ? "nabin-badge--success"
                          : service.status === "DEGRADED"
                            ? "nabin-badge--warning"
                            : "nabin-badge--danger"
                      }`}
                    >
                      {service.status === "PAUSED" ? "Paused" : service.status}
                    </span>
                  </div>
                  <p style={{ color: "var(--ink-muted)", fontSize: 14, margin: "var(--space-xs) 0 var(--space-lg)", lineHeight: 1.5 }}>
                    {service.description || meta?.blurb}
                  </p>
                  {service.broadcastNotice && (
                    <p className="nabin-notice" role="status">
                      {service.broadcastNotice}
                    </p>
                  )}
                </div>
                {isAvailable ? (
                  <Link
                    href={meta?.href ?? "/"}
                    className="nabin-btn nabin-btn--primary"
                    style={{ width: "100%", textAlign: "center", textDecoration: "none" }}
                  >
                    Open {meta?.label ?? service.name} &rarr;
                  </Link>
                ) : (
                  <button className="nabin-btn nabin-btn--ghost" disabled style={{ width: "100%" }}>
                    Temporarily unavailable
                  </button>
                )}
              </article>
            );
          })}
        </div>
      )}
    </AppShell>
  );
}
