/**
 * Login page with email input and OTP verification.
 *
 * Two-step flow:
 * 1. User enters email, clicks "Send Code"
 * 2. User enters OTP code from email, clicks "Verify"
 *
 * On successful verification, user is redirected to Home.
 */

import { useState, type FormEvent } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { OtpInput } from "../components/auth/OtpInput";
import { trackSignupStarted, trackSignupCompleted } from "../lib/analytics";

type LoginStep = "email" | "otp";

interface LoginProps {
  /** If true, don't redirect after authentication (for embedded use in JoinList etc.) */
  embedded?: boolean;
}

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 6) return "Burning the midnight oil?";
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  if (hour < 21) return "Good evening";
  return "Late night organizing?";
}

export function Login({ embedded = false }: LoginProps) {
  const { startOtp, verifyOtp, isLoading, isAuthenticated } = useAuth();
  const navigate = useNavigate();

  const [step, setStep] = useState<LoginStep>("email");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSendingCode, setIsSendingCode] = useState(false);

  // Redirect if already authenticated (unless embedded)
  if (isAuthenticated && !embedded) {
    navigate("/d", { replace: true });
    return null;
  }

  const validateEmail = (email: string): boolean => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  };

  const handleEmailSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    const trimmedEmail = email.trim().toLowerCase();
    if (!trimmedEmail) {
      setError("Please enter your email address");
      return;
    }

    if (!validateEmail(trimmedEmail)) {
      setError("Please enter a valid email address");
      return;
    }

    try {
      setIsSendingCode(true);
      await startOtp(trimmedEmail);
      trackSignupStarted(trimmedEmail);
      setStep("otp");
    } catch (err) {
      console.error("Failed to send OTP:", err);
      setError("Failed to send verification code. Please try again.");
    } finally {
      setIsSendingCode(false);
    }
  };

  const handleOtpComplete = async (code: string) => {
    setError(null);

    try {
      await verifyOtp(code);
      trackSignupCompleted("free");
      // On successful verification, useAuth will update isAuthenticated
      // If not embedded, redirect to app; if embedded, parent handles navigation
      if (!embedded) {
        navigate("/d", { replace: true });
      }
    } catch (err) {
      console.error("Failed to verify OTP:", err);
      // Show actual error message for debugging
      const message = err instanceof Error ? err.message : "Verification failed";
      setError(message);
    }
  };

  const handleBackToEmail = () => {
    setStep("email");
    setError(null);
  };

  const handleResendOtp = async () => {
    setError(null);
    const trimmedEmail = email.trim().toLowerCase();
    try {
      await startOtp(trimmedEmail);
    } catch (err) {
      console.error("Failed to resend OTP:", err);
      setError("Failed to resend verification code. Please try again.");
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4" style={{ background: 'var(--boop-bg)' }}>
      {/* Brand header */}
      {!embedded && (
        <Link to="/" className="boop-wordmark boop-wordmark-light text-[26px] mb-8 hover:opacity-80 transition-opacity" aria-label="boop">
          <span className="boop-dot" aria-hidden="true" />
          <span>boop</span>
        </Link>
      )}

      <div className="bg-white rounded-2xl border border-stone-200 max-w-md w-full p-8">
        <h1 className="text-2xl font-bold text-stone-900 mb-2 text-center">
          {step === "email" ? getGreeting() : "Check your email"}
        </h1>
        <p className="text-stone-500 mb-6 text-center text-sm">
          {step === "email"
            ? "Sign in with your email to get started"
            : `We sent a code to ${email}`}
        </p>

        {step === "email" ? (
          <form onSubmit={handleEmailSubmit}>
            <label
              htmlFor="email"
              className="block text-sm font-medium text-stone-700 mb-1"
            >
              Email address
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full px-4 py-3 border border-stone-200 rounded-xl text-stone-900 bg-white focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
              disabled={isLoading}
              autoFocus
              autoComplete="email"
            />

            {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

            <button
              type="submit"
              disabled={isLoading || !email.trim()}
              className="mt-4 w-full bg-amber-500 text-white py-3 px-4 rounded-full font-semibold hover:bg-amber-600 active:bg-amber-700 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isSendingCode ? "Sending code..." : "Send Code"}
            </button>
          </form>
        ) : (
          <div>
            <OtpInput
              onComplete={handleOtpComplete}
              isLoading={isLoading}
              error={error}
              onResend={handleResendOtp}
            />

            <button
              type="button"
              onClick={handleBackToEmail}
              disabled={isLoading}
              className="mt-4 w-full text-stone-600 py-2 px-4 rounded-xl font-medium hover:text-stone-900 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 disabled:opacity-50"
            >
              Use a different email
            </button>
          </div>
        )}

        <p className="mt-6 text-xs text-stone-400 text-center">
          Your keys are securely managed by Turnkey
        </p>
      </div>
    </div>
  );
}
