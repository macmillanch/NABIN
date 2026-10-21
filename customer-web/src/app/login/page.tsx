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
      // The only honest reading of a request that did not complete: the code was not sent. It used
      // to be treated as a demo, on the shape of the phone number alone — `98765` or "demo" in the
      // string walked the user to the code step with 123456 already typed in. A real customer whose
      // number happens to match, on an afternoon when the API is down, was handed a code that no
      // server had sent and a screen that said it had.
      const apiError = err as { response?: { data?: { error?: string } } };
      setError(apiError.response?.data?.error || "Could not reach the NABIN API. Check your connection and try again.");
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
      // Same rule one step later. This branch used to hand out a session whenever the code looked
      // like the demo code or the number looked like the demo number, so a refused OTP and an
      // unreachable API both ended with a customer who is VERIFIED, has an id, and whose token the
      // backend rejects on the next request (web_auth_failopen_test.js WAF-14 measures that
      // refusal). A sign-in is something the server does; on this path the server did not answer.
      const apiError = err as { response?: { data?: { error?: string } } };
      setError(apiError.response?.data?.error || "Could not verify the code. Check your connection and try again.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="nabin-auth">
      <div className="nabin-card nabin-auth__card">
        <div style={{ textAlign: "center", marginBottom: 12 }}>
          <img src="/nabin_logo_full.png" alt="NABIN" style={{ height: 36, width: "auto", margin: "0 auto", display: "inline-block" }} />
        </div>
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
            <button
              type="button"
              className="nabin-btn nabin-btn--outline"
              style={{ marginTop: "var(--space-xs)", width: "100%" }}
              onClick={() => {
                login("demo-customer-token", {
                  id: "customer-demo-01",
                  name: "Lalrinfela (Customer)",
                  phone: "+91 98765 43210",
                  role: "CUSTOMER",
                  identityStatus: "IDENTITY_VERIFICATION_PENDING",
                });
              }}
            >
              ⚡ Explore Customer Portal (Demo Mode) →
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
            <button
              type="button"
              className="nabin-btn nabin-btn--outline"
              style={{ marginTop: "var(--space-xs)", width: "100%" }}
              onClick={() => {
                login("demo-customer-token", {
                  id: "customer-demo-01",
                  name: "Lalrinfela (Customer)",
                  phone: "+91 98765 43210",
                  role: "CUSTOMER",
                  identityStatus: "IDENTITY_VERIFICATION_PENDING",
                });
              }}
            >
              ⚡ Instant Demo Sign-In →
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
