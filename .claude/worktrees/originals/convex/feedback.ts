/**
 * Feedback module — in-app user feedback collection.
 *
 * submit: users submit feedback from Settings page.
 * updateStatus: internal/admin mutation to triage feedback.
 * sendWelcomeEmail: internal action triggered on new user signup.
 */

import { v } from "convex/values";
import { internalAction, internalMutation, mutation } from "./_generated/server";

// ---------------------------------------------------------------------------
// Public mutations
// ---------------------------------------------------------------------------

/**
 * Submit in-app feedback. Authenticated via userId passed from frontend.
 * Takes body and category; source is always "in_app", status starts as "new".
 */
export const submit = mutation({
  args: {
    userId: v.id("users"),
    body: v.string(),
    category: v.union(v.literal("bug"), v.literal("feature"), v.literal("praise"), v.literal("confusion"), v.literal("churn_risk")),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("feedback", {
      userId: args.userId,
      source: "in_app",
      category: args.category,
      body: args.body,
      status: "new",
      createdAt: Date.now(),
    });
  },
});

// ---------------------------------------------------------------------------
// Internal mutations (admin/system use only)
// ---------------------------------------------------------------------------

/**
 * Update feedback status. Internal — call via admin script or HTTP action.
 */
export const updateStatus = internalMutation({
  args: {
    feedbackId: v.id("feedback"),
    status: v.union(v.literal("new"), v.literal("acknowledged"), v.literal("acted_on"), v.literal("wont_fix")),
    respondedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const patch: { status: typeof args.status; respondedAt?: number } = {
      status: args.status,
    };
    if (args.respondedAt !== undefined) {
      patch.respondedAt = args.respondedAt;
    }
    await ctx.db.patch(args.feedbackId, patch);
  },
});

// ---------------------------------------------------------------------------
// Internal actions
// ---------------------------------------------------------------------------

/**
 * Send one-time welcome email via Resend on first user signup.
 * Silently skips if RESEND_API_KEY is not configured.
 */
export const sendWelcomeEmail = internalAction({
  args: {
    email: v.string(),
    displayName: v.string(),
  },
  handler: async (_ctx, args) => {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) return; // Resend not configured — skip silently

    const body = `Hey ${args.displayName},

Thanks for trying boop. You're one of our first users and that means your opinion actually matters to us.

Quick question: what's the one thing you'd want us to build next?

Just reply to this email. I read every one.

— Brian, boop

P.S. If something broke or felt weird, tell me that too. No feelings will be hurt.`;

    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "brian@boop.ad",
        to: args.email,
        subject: "You're in. What should we build next?",
        text: body,
      }),
    });
  },
});
