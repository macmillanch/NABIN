"use client";

import { useAuth } from "@/context/AuthContext";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useEffect } from "react";

export default function ProfilePage() {
  const { user, loading, logout } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) {
      router.push("/login");
    }
  }, [user, loading, router]);

  if (loading || !user) {
    return <div className="container" style={{ padding: "2rem" }}>Loading...</div>;
  }

  return (
    <div className="container" style={{ padding: "2rem 1rem", maxWidth: "600px" }}>
      <header style={{ marginBottom: "2rem", display: "flex", alignItems: "center", gap: "1rem" }}>
        <Link href="/" style={{ color: "var(--text-muted)", fontSize: "1.25rem", textDecoration: "none" }}>
          &larr;
        </Link>
        <h1 style={{ fontSize: "1.5rem", margin: 0 }}>My Profile</h1>
      </header>

      <div className="card">
        <div style={{ marginBottom: "1.5rem" }}>
          <h2 style={{ fontSize: "1.25rem", marginBottom: "1rem" }}>Account Details</h2>
          
          <div style={{ marginBottom: "1rem" }}>
            <label style={{ display: "block", color: "var(--text-muted)", fontSize: "0.875rem", marginBottom: "0.25rem" }}>Phone Number</label>
            <div style={{ fontWeight: "500", fontSize: "1.125rem" }}>{user.phone}</div>
          </div>
          
          <div style={{ marginBottom: "1rem" }}>
            <label style={{ display: "block", color: "var(--text-muted)", fontSize: "0.875rem", marginBottom: "0.25rem" }}>Customer ID</label>
            <div style={{ fontWeight: "500", fontFamily: "monospace", background: "var(--surface-hover)", padding: "0.5rem", borderRadius: "var(--radius-sm)" }}>
              {user.id}
            </div>
          </div>
        </div>

        <button 
          onClick={logout}
          style={{ width: "100%", padding: "0.75rem", background: "var(--error)", color: "white", border: "none", borderRadius: "var(--radius-md)", cursor: "pointer", fontWeight: "500", fontSize: "1rem" }}
        >
          Log Out
        </button>
      </div>
    </div>
  );
}
