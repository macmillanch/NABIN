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
      const apiError = err as { response?: { data?: { error?: string } } };
      setError(apiError.response?.data?.error || "Could not reach the NABIN API.");
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
      const apiError = err as { response?: { data?: { error?: string } } };
      setError(apiError.response?.data?.error || "Could not verify the code.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="nabin-auth">
      <div className="nabin-card nabin-auth__card">
        <p className="nabin-wordmark" style={{ fontSize: 26, textAlign: "center" }}>
          NABIN
        </p>
        <p className="nabin-auth__subtitle">
          {step === "phone" ? "Sign in with your phone number" : `We sent a code to ${phone}`}
        </p>

        {error && (
          <div className="nabin-alert nabin-alert--danger" role="alert">
            <span>{error}</span>
          </div>
        )}

        {step === "phone" ? (
          <form onSubmit={handleSendOtp} className="nabin-form">
            <div>
              <label className="nabin-label" htmlFor="phone">
                Phone number
              </label>
              <input
                id="phone"
                className="nabin-input"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+91 98765 43210"
                disabled={isLoading}
                required
              />
            </div>
            <button type="submit" className="nabin-btn nabin-btn--primary" disabled={isLoading}>
              {isLoading ? "Sending…" : "Send OTP"}
            </button>
          </form>
        ) : (
          <form onSubmit={handleVerifyOtp} className="nabin-form">
            <div>
              <label className="nabin-label" htmlFor="otp">
                One-time code
              </label>
              <input
                id="otp"
                className="nabin-input nabin-input--otp"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
                placeholder="000000"
                disabled={isLoading}
                required
              />
            </div>
            <button type="submit" className="nabin-btn nabin-btn--primary" disabled={isLoading}>
              {isLoading ? "Verifying…" : "Verify & continue"}
            </button>
            <button
              type="button"
              onClick={() => {
                setStep("phone");
                setOtp("");
                setError("");
              }}
              className="nabin-btn nabin-btn--ghost"
              disabled={isLoading}
            >
              Use a different number
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
