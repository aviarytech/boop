/**
 * Hook for accessing and managing the current user's billing subscription.
 */

import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useCurrentUser } from "./useCurrentUser";

export type Plan = "free" | "pro" | "team";

export interface BillingState {
  plan: Plan;
  subscription: {
    status: string;
    currentPeriodEnd?: number;
    cancelAtPeriodEnd?: boolean;
    stripeSubscriptionId?: string;
  } | null;
  isLoading: boolean;
  isPro: boolean;
  isTeam: boolean;
  isPaid: boolean;
}

export function useBilling(): BillingState {
  const { subOrgId, isAuthenticated } = useCurrentUser();

  const convexUser = useQuery(
    api.auth.getUserByTurnkeyId,
    isAuthenticated && subOrgId ? { turnkeySubOrgId: subOrgId } : "skip"
  );

  const subscription = useQuery(
    api.billing.getUserSubscription,
    convexUser?._id ? { userId: convexUser._id } : "skip"
  );

  // Use server-computed plan so referral Pro credits are reflected
  const serverPlan = useQuery(
    api.billing.getUserPlan,
    convexUser?._id ? { userId: convexUser._id } : "skip"
  );

  const isLoading = !isAuthenticated ? false : (convexUser === undefined || subscription === undefined || serverPlan === undefined);

  const plan: Plan = (serverPlan as Plan) ?? "free";

  return {
    plan,
    subscription: subscription ?? null,
    isLoading,
    isPro: plan === "pro" || plan === "team",
    isTeam: plan === "team",
    isPaid: plan !== "free",
  };
}
