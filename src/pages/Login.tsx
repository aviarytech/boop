/**
 * Login page with email input and OTP verification.
 *
 * Two-step flow:
 * 1. User enters email, clicks "Send Code"
 * 2. User enters OTP code from email, clicks "Verify"
 *
 * On successful verification, resume the intended page or selected runbook.
 */

import { useState, type FormEvent } from "react";
import { Navigate, useLocation, Link } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { OtpInput } from "../components/auth/OtpInput";
import { trackSignupStarted, trackSignupCompleted } from "../lib/analytics";

import { loginDestination } from "../lib/loginDestination";

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
  const location = useLocation();

  const [step, setStep] = useState<LoginStep>("email");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSendingCode, setIsSendingCode] = useState(false);

  // Redirect if already authenticated (unless embedded)
  if (isAuthenticated && !embedded) {
    const destination = loginDestination(location.search, location.state);
    return <Navigate to={destination.to} state={destination.state} replace />;
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
      // Auth state drives the redirect while this page is still mounted.
      // A late OTP response must not override navigation away from login.
      // Embedded callers own their navigation.
    } catch (err) {
      console.error("Failed to verify OTP:", err);
      // Server sanitizes /auth/verify errors, so its message is safe to show.
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

      <div className="boop-sheet max-w-md w-full p-8">
        <h1 className="text-2xl font-bold text-[var(--boop-ink)] mb-2 text-center">
          {step === "email" ? getGreeting() : "Check your email"}
        </h1>
        <p className="text-[var(--boop-muted)] mb-6 text-center text-sm">
          {step === "email"
            ? "Sign in with your email to get started"
            : `We sent a code to ${email}`}
        </p>

        {step === "email" ? (
          <form onSubmit={handleEmailSubmit}>
            <label
              htmlFor="email"
              className="block text-sm font-medium text-[var(--boop-ink)] mb-1"
            >
              Email address
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full px-4 py-3 border border-[var(--boop-line)] rounded-xl text-[var(--boop-ink)] bg-[var(--boop-card)] focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
              disabled={isLoading}
              autoFocus
              autoComplete="email"
            />

            {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}

            <button
              type="submit"
              disabled={isLoading || !email.trim()}
              className="mt-4 w-full bg-amber-500 text-white py-3 px-4 rounded-xl font-semibold hover:bg-amber-600 active:bg-amber-700 disabled:bg-[var(--boop-panel)] disabled:text-[var(--boop-dim)] disabled:cursor-not-allowed transition-colors"
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
              className="mt-4 w-full text-[var(--boop-muted)] py-2 px-4 rounded-xl font-medium hover:text-[var(--boop-ink)] disabled:opacity-50"
            >
              Use a different email
            </button>
          </div>
        )}

        <p className="mt-6 text-xs text-[var(--boop-muted)] text-center">
          Your keys are securely managed by Turnkey
        </p>
      </div>
    </div>
  );
}

