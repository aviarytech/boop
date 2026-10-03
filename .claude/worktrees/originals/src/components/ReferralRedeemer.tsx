/**
 * ReferralRedeemer — runs once after a user signs in.
 *
 * Checks localStorage for a pending referral code. If one exists and the
 * current user has a resolved Convex userId, it calls redeemReferral and
 * clears the stored code.
 *
 * Mount this inside the authenticated layout so it runs for all auth'd users.
 */

import { useEffect, useRef } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useCurrentUser } from "../hooks/useCurrentUser";
import { REFERRAL_CODE_KEY } from "../pages/InviteLanding";

export function ReferralRedeemer() {
  const { subOrgId, isAuthenticated } = useCurrentUser();
  const convexUser = useQuery(
    api.auth.getUserByTurnkeyId,
    isAuthenticated && subOrgId ? { turnkeySubOrgId: subOrgId } : "skip"
  );
  const redeemReferral = useMutation(api.referrals.redeemReferral);
  const attemptedRef = useRef(false);

  useEffect(() => {
    if (attemptedRef.current) return;
    if (!convexUser?._id) return;

    const code = localStorage.getItem(REFERRAL_CODE_KEY);
    if (!code) return;

    // Mark as attempted immediately to prevent double-fire
    attemptedRef.current = true;
    localStorage.removeItem(REFERRAL_CODE_KEY);

    redeemReferral({ code, refereeUserId: convexUser._id }).catch((err) => {
      console.error("[ReferralRedeemer] Failed to redeem referral:", err);
    });
  }, [convexUser?._id, redeemReferral]);

  return null;
}
