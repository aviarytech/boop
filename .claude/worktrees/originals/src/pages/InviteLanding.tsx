/**
 * Referral invite landing page — /invite/:code
 *
 * Stores the referral code in localStorage, then redirects to sign-up.
 * After the user authenticates, the ReferralRedeemer component picks up
 * the stored code and calls redeemReferral to award the inviter their bonus.
 */

import { useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";

export const REFERRAL_CODE_KEY = "poo-referral-code";

export function InviteLanding() {
  const { code } = useParams<{ code: string }>();
  const { isAuthenticated } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (code) {
      localStorage.setItem(REFERRAL_CODE_KEY, code);
    }

    if (isAuthenticated) {
      // Already logged in — go to app (redemption happens via ReferralRedeemer)
      navigate("/d", { replace: true });
    } else {
      navigate("/login", { replace: true });
    }
  }, [code, isAuthenticated, navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: 'var(--boop-bg)' }}>
      <div className="text-center">
        <div
          className="mx-auto mb-5 rounded-full animate-pulse-ring"
          style={{ width: 56, height: 56, background: 'var(--boop-accent)' }}
          aria-hidden="true"
        />
        <p className="text-stone-600 dark:text-stone-300 font-medium">Getting your invite ready…</p>
      </div>
    </div>
  );
}
