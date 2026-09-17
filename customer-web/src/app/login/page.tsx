"use client";

import { useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { authApi } from "@/lib/api";

export default function LoginPage() {
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [step, setStep] = useState<"phone" | "otp">("phone");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const { login } = useAuth();

  const handleSendOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!phone) return;
    setIsLoading(true);
    setError("");
    try {
      const res = await authApi.sendOtp(phone);
      if (res.data.success) {
        setStep("otp");
      } else {
        setError(res.data.error || "Failed to send OTP");
      }
    } catch (err: unknown) {
      const error = err as { response?: { data?: { error?: string } } };
      setError(error.response?.data?.error || "Error connecting to server");
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!otp) return;
    setIsLoading(true);
    setError("");
    try {
      const res = await authApi.verifyOtp(phone, otp);
      if (res.data.success) {
        login(res.data.token, res.data.user);
      } else {
        setError(res.data.error || "Invalid OTP");
      }
    } catch (err: unknown) {
      const error = err as { response?: { data?: { error?: string } } };
      setError(error.response?.data?.error || "Error verifying OTP");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="container" style={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: "100vh" }}>
      <div className="card" style={{ maxWidth: "400px", width: "100%" }}>
        <h1 style={{ marginBottom: "1rem", textAlign: "center" }}>NABIN Customer</h1>
        {error && <div style={{ color: "var(--error)", marginBottom: "1rem", padding: "0.5rem", background: "rgba(239, 68, 68, 0.1)", borderRadius: "var(--radius-sm)" }}>{error}</div>}
        
        {step === "phone" ? (
          <form onSubmit={handleSendOtp} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            <div>
              <label htmlFor="phone" style={{ display: "block", marginBottom: "0.5rem", fontWeight: "500" }}>Phone Number</label>
              <input
                id="phone"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+1234567890"
                className="input"
                disabled={isLoading}
                required
              />
            </div>
            <button type="submit" className="btn-primary" disabled={isLoading}>
              {isLoading ? "Sending..." : "Send OTP"}
            </button>
          </form>
        ) : (
          <form onSubmit={handleVerifyOtp} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            <div>
              <label htmlFor="otp" style={{ display: "block", marginBottom: "0.5rem", fontWeight: "500" }}>Enter OTP</label>
              <input
                id="otp"
                type="text"
                value={otp}
                onChange={(e) => setOtp(e.target.value)}
                placeholder="123456"
                className="input"
                disabled={isLoading}
                required
              />
            </div>
            <button type="submit" className="btn-primary" disabled={isLoading}>
              {isLoading ? "Verifying..." : "Verify & Login"}
            </button>
            <button 
              type="button" 
              onClick={() => setStep("phone")}
              style={{ background: "none", color: "var(--text-muted)", marginTop: "0.5rem" }}
              disabled={isLoading}
            >
              Back
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
