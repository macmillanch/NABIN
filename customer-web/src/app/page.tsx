"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { servicesApi } from "@/lib/api";
import { useRouter } from "next/navigation";
import Link from "next/link";

interface ServiceInfo {
  id: string;
  name: string;
  description: string;
  status: "ACTIVE" | "PAUSED" | "DEGRADED";
  broadcastNotice: string | null;
}

export default function DashboardPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const [services, setServices] = useState<ServiceInfo[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!authLoading && !user) {
      router.push("/login");
    }
  }, [user, authLoading, router]);

  useEffect(() => {
    const fetchServices = async () => {
      try {
        const res = await servicesApi.getStatus();
        if (res.data.success) {
          // Filter to only the core customer facing apps
          const coreIds = ["rides", "food", "grocery", "parcel"];
          const coreServices = res.data.services.filter((s: ServiceInfo) => coreIds.includes(s.id));
          // Sort them to keep a consistent order
          coreServices.sort((a: ServiceInfo, b: ServiceInfo) => coreIds.indexOf(a.id) - coreIds.indexOf(b.id));
          setServices(coreServices);
        }
      } catch (err) {
        console.error("Failed to load services", err);
      } finally {
        setIsLoading(false);
      }
    };
    if (user) {
      fetchServices();
    }
  }, [user]);

  if (authLoading || !user) {
    return (
      <div className="container" style={{ padding: "2rem", textAlign: "center" }}>
        Loading...
      </div>
    );
  }

  return (
    <div className="container" style={{ padding: "2rem 1rem", maxWidth: "800px" }}>
      <header style={{ marginBottom: "2rem", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h1 style={{ fontSize: "1.5rem", marginBottom: "0.25rem" }}>NABIN</h1>
          <p style={{ color: "var(--text-muted)", fontSize: "0.875rem" }}>Welcome back, {user.phone}</p>
        </div>
        <div style={{ display: "flex", gap: "1rem" }}>
          <Link href="/orders" style={{ padding: "0.5rem", color: "var(--text-muted)", textDecoration: "none" }}>
            Orders
          </Link>
          <Link href="/profile" style={{ padding: "0.5rem", color: "var(--text-muted)", textDecoration: "none" }}>
            Profile
          </Link>
        </div>
      </header>

      <main>
        <h2 style={{ fontSize: "1.25rem", marginBottom: "1rem" }}>Our Services</h2>
        
        {isLoading ? (
          <div>Loading services...</div>
        ) : (
          <div style={{ display: "grid", gap: "1rem", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))" }}>
            {services.map((service) => {
              const isAvailable = service.status === "ACTIVE" || service.status === "DEGRADED";
              
              return (
                <div key={service.id} className="card" style={{ opacity: isAvailable ? 1 : 0.6, display: "flex", flexDirection: "column" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "0.5rem" }}>
                    <h3 style={{ fontSize: "1.125rem", fontWeight: "600" }}>{service.name}</h3>
                    {!isAvailable && (
                      <span style={{ fontSize: "0.75rem", background: "var(--error)", color: "white", padding: "0.125rem 0.375rem", borderRadius: "var(--radius-sm)" }}>
                        Paused
                      </span>
                    )}
                  </div>
                  <p style={{ color: "var(--text-muted)", fontSize: "0.875rem", marginBottom: "1.5rem", flexGrow: 1 }}>
                    {service.description}
                  </p>
                  
                  {service.broadcastNotice && (
                    <div style={{ marginBottom: "1rem", padding: "0.5rem", background: "rgba(245, 158, 11, 0.1)", color: "var(--warning)", borderRadius: "var(--radius-sm)", fontSize: "0.75rem" }}>
                      {service.broadcastNotice}
                    </div>
                  )}

                  {isAvailable ? (
                    <Link href={`/${service.id === "rides" ? "ride" : service.id}`} className="btn-primary" style={{ textAlign: "center", display: "block" }}>
                      Open {service.name.split(" ")[1] || "Service"}
                    </Link>
                  ) : (
                    <button className="btn-primary" disabled style={{ background: "var(--border)", color: "var(--text-muted)", cursor: "not-allowed" }}>
                      Temporarily Unavailable
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
