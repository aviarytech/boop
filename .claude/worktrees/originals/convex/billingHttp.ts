/**
 * HTTP action handlers for Stripe billing.
 *
 * POST /api/stripe/webhook — Stripe webhook (no auth, verified by signature)
 * POST /api/billing/checkout — Create Stripe Checkout session (requires auth)
 * POST /api/billing/portal  — Create Stripe Customer Portal session (requires auth)
 * GET  /api/billing/subscription — Get current user subscription (requires auth)
 *
 * All Stripe SDK usage lives in billingActions.ts ("use node") — HTTP actions
 * run in Convex's default runtime and delegate to Node.js actions as needed.
 */

import { httpAction } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { requireAuth } from "./lib/auth";
import { jsonResponse, errorResponse } from "./lib/httpResponses";
import type { Id } from "./_generated/dataModel";

/**
 * POST /api/stripe/webhook
 *
 * Handles: checkout.session.completed, customer.subscription.updated,
 *          customer.subscription.deleted
 */
export const stripeWebhook = httpAction(async (ctx, request) => {
  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return new Response("Missing Stripe-Signature header", { status: 400 });
  }

  const body = await request.text();

  try {
    await ctx.runAction(internal.billingActions.processWebhook, {
      body,
      signature,
    });
  } catch (err) {
    console.error("[stripeWebhook] error:", err);
    return new Response("Webhook processing failed", { status: 500 });
  }

  return new Response("OK", { status: 200 });
});

/**
 * POST /api/billing/checkout
 * Body: { priceId, successUrl, cancelUrl }
 */
export const createCheckout = httpAction(async (ctx, request) => {
  try {
    const auth = await requireAuth(request);
    const user = await ctx.runQuery(api.auth.getUserByTurnkeyId, {
      turnkeySubOrgId: auth.turnkeySubOrgId,
    }) as { _id: Id<"users">; email?: string } | null;
    if (!user) return errorResponse(request, "User not found", 404);

    const body = await request.json() as { priceId: string; successUrl: string; cancelUrl: string };
    const { priceId, successUrl, cancelUrl } = body;

    if (!priceId || !successUrl || !cancelUrl) {
      return errorResponse(request, "priceId, successUrl, cancelUrl required", 400);
    }

    const url: string = await ctx.runAction(internal.billingActions.createCheckoutSession, {
      userId: user._id,
      email: user.email ?? "",
      priceId,
      successUrl,
      cancelUrl,
    });

    return jsonResponse(request, { url });
  } catch (err) {
    console.error("[createCheckout] error:", err);
    return errorResponse(request, err instanceof Error ? err.message : "Failed", 500);
  }
});

/**
 * POST /api/billing/portal
 * Body: { returnUrl }
 */
export const createPortal = httpAction(async (ctx, request) => {
  try {
    const auth = await requireAuth(request);
    const user = await ctx.runQuery(api.auth.getUserByTurnkeyId, {
      turnkeySubOrgId: auth.turnkeySubOrgId,
    }) as { _id: Id<"users"> } | null;
    if (!user) return errorResponse(request, "User not found", 404);

    const body = await request.json() as { returnUrl: string };

    const url: string = await ctx.runAction(internal.billingActions.createPortalSession, {
      userId: user._id,
      returnUrl: body.returnUrl,
    });

    return jsonResponse(request, { url });
  } catch (err) {
    console.error("[createPortal] error:", err);
    return errorResponse(request, err instanceof Error ? err.message : "Failed", 500);
  }
});

/**
 * GET /api/billing/subscription
 * Returns current plan info for authenticated user.
 */
export const getSubscription = httpAction(async (ctx, request) => {
  try {
    const auth = await requireAuth(request);
    const user = await ctx.runQuery(api.auth.getUserByTurnkeyId, {
      turnkeySubOrgId: auth.turnkeySubOrgId,
    }) as { _id: Id<"users"> } | null;
    if (!user) return errorResponse(request, "User not found", 404);

    const sub = await ctx.runQuery(internal.billing.querySubscriptionByUserId, {
      userId: user._id,
    });

    return jsonResponse(request, { subscription: sub, plan: sub?.plan ?? "free" });
  } catch (err) {
    console.error("[getSubscription] error:", err);
    return errorResponse(request, err instanceof Error ? err.message : "Failed", 500);
  }
});
