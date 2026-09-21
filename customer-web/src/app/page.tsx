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

const SERVICE_META: Record<string, { href: string; label: string; blurb: string; accent: string }> = {
  rides: { href: "/ride", label: "Ride", blurb: "Bike, auto and cab trips with live driver tracking.", accent: "var(--ride-blue)" },
  food: { href: "/food", label: "Food", blurb: "Order from nearby restaurants and follow preparation.", accent: "var(--food-orange)" },
  grocery: { href: "/grocery", label: "Grocery", blurb: "Daily staples packed by a nearby store.", accent: "var(--grocery-green)" },
  parcel: { href: "/parcel", label: "Parcel", blurb: "Send a package across the city with proof of delivery.", accent: "var(--parcel-teal)" },
};

export default function DashboardPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const [services, setServices] = useState<ServiceInfo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
        if (res.data.success) {
          const core = (res.data.services as ServiceInfo[]).filter((s) =>
            (SERVICE_ORDER as readonly string[]).includes(s.id),
          );
          core.sort((a, b) => SERVICE_ORDER.indexOf(a.id as (typeof SERVICE_ORDER)[number]) - SERVICE_ORDER.indexOf(b.id as (typeof SERVICE_ORDER)[number]));
          setServices(core);
          setError(null);
        } else {
          setError("The platform returned no services.");
        }
      } catch {
        setError("Could not reach the NABIN API. Start the backend on port 4000.");
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

      <h2 className="nabin-section-title">Services</h2>
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
              <article key={service.id} className={`nabin-card ${isAvailable ? "nabin-card--interactive" : ""}`}>
                <div className="nabin-card__header">
                  <span className="nabin-service-dot" style={{ background: meta?.accent }} aria-hidden="true" />
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
                <h3 style={{ fontSize: 18, fontWeight: 800 }}>{meta?.label ?? service.name}</h3>
                <p style={{ color: "var(--ink-muted)", fontSize: 14, margin: "var(--space-xxs) 0 var(--space-lg)" }}>
                  {service.description || meta?.blurb}
                </p>
                {service.broadcastNotice && (
                  <p className="nabin-notice" role="status">
                    {service.broadcastNotice}
                  </p>
                )}
                {isAvailable ? (
                  <Link href={meta?.href ?? "/"} className="nabin-btn nabin-btn--primary">
                    Open {meta?.label ?? service.name}
                  </Link>
                ) : (
                  <button className="nabin-btn nabin-btn--ghost" disabled>
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
