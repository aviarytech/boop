/**
 * Manual Pro grants (comps, support gestures, apology credits).
 *
 * Uses referralProUntil rather than writing a subscriptions row. A hand-made
 * subscription needs a stripeCustomerId, and both createCheckoutSession and
 * createPortalSession pass that value straight to Stripe — an invented one
 * would break the user's ability to ever actually pay, which is the opposite of
 * a favour. referralProUntil is honoured by getUserPlan (billing.ts) and by the
 * list quota (assertListQuota in lists.ts), and leaves Stripe untouched.
 *
 * internalMutation: callable from the CLI and other Convex functions, never
 * from a client.
 *
 *   npx convex run --prod adminGrants:grantProByEmail '{"email":"…","until":…}'
 */

import { v } from "convex/values";
import { internalMutation } from "./_generated/server";

export const grantProByEmail = internalMutation({
  args: {
    email: v.string(),
    /** Epoch ms the grant expires. Must be in the future to have any effect. */
    until: v.number(),
  },
  handler: async (ctx, args) => {
    const matches = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", args.email))
      .collect();

    if (matches.length === 0) throw new Error(`No user with email ${args.email}`);
    // Email is not unique in the schema; granting to the wrong one of several
    // is worse than refusing and making the caller name an id.
    if (matches.length > 1) {
      throw new Error(
        `${matches.length} users share ${args.email} — refusing to guess which to grant`
      );
    }

    const user = matches[0];
    const previous = user.referralProUntil ?? null;

    if (args.until <= Date.now()) {
      throw new Error("`until` is in the past — that would grant nothing");
    }

    await ctx.db.patch(user._id, { referralProUntil: args.until });

    return {
      userId: user._id,
      email: user.email,
      previousReferralProUntil: previous,
      referralProUntil: args.until,
      expires: new Date(args.until).toISOString(),
    };
  },
});

/** Undo a grant — clears the field entirely rather than setting it to zero. */
export const revokeProByEmail = internalMutation({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    const matches = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", args.email))
      .collect();
    if (matches.length !== 1) {
      throw new Error(`Expected exactly one user for ${args.email}, found ${matches.length}`);
    }
    const previous = matches[0].referralProUntil ?? null;
    await ctx.db.patch(matches[0]._id, { referralProUntil: undefined });
    return { userId: matches[0]._id, clearedReferralProUntil: previous };
  },
});
