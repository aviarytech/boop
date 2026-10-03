import type { QueryCtx } from "../_generated/server";
import { getEffectivePlan, PLANS, requirePlan } from "../billing";
import { PlanError } from "./planError";

type DbCtx = Pick<QueryCtx, "db">;

async function siteOwner(ctx: DbCtx, ownerDid: string) {
  const user = await ctx.db.query("users").withIndex("by_did", q => q.eq("did", ownerDid)).first()
    ?? await ctx.db.query("users").withIndex("by_legacy_did", q => q.eq("legacyDid", ownerDid)).first();
  if (!user?.did || user.deletionRequestedAt !== undefined) throw new Error("Site owner unavailable");
  return user;
}

export async function getSiteAllowance(ctx: DbCtx, ownerDid: string) {
  const user = await siteOwner(ctx, ownerDid);
  const plan = await getEffectivePlan(ctx, user._id);
  const maxSites = PLANS[plan].maxSites;
  const identities = [...new Set([user.did, user.legacyDid].filter((did): did is string => !!did))];
  // Indexed range reads participate in Convex OCC. The insert must happen in
  // this same mutation so two creates for the final slot cannot both commit.
  const owned = await Promise.all(identities.map(did => ctx.db.query("sites")
    .withIndex("by_owner", q => q.eq("ownerDid", did)).take(maxSites)));
  const count = owned.reduce((total, sites) => total + sites.length, 0);
  return { plan, maxSites, customDomains: PLANS[plan].customDomains, canCreate: count < maxSites };
}

export async function requireSiteCapacity(ctx: DbCtx, ownerDid: string) {
  const allowance = await getSiteAllowance(ctx, ownerDid);
  if (!allowance.canCreate) {
    const advice = allowance.plan === "free"
      ? "Upgrade to Pro at /pricing for 5 sites and custom domains."
      : "Pro and Team include 5 sites per account. You can still update your existing sites.";
    throw new PlanError("SITE_LIMIT", `Your ${PLANS[allowance.plan].name} plan includes ${allowance.maxSites} site${allowance.maxSites === 1 ? "" : "s"}. ${advice}`);
  }
}

export async function requireCustomDomains(ctx: DbCtx, ownerDid: string) {
  const user = await siteOwner(ctx, ownerDid);
  await requirePlan(ctx, user._id, "pro");
}
