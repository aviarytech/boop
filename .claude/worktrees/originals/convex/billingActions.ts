"use node";
/**
 * Billing actions that require Node.js (Stripe SDK uses crypto, http, etc.)
 *
 * "use node" must be the first statement — stripe@20 uses Node.js built-in APIs
 * (crypto, events, child_process) that are not available in Convex's V8 isolate.
 */

import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import Stripe from "stripe";
import type { Id } from "./_generated/dataModel";

function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY not configured");
  return new Stripe(key);
}

/**
 * Create a Stripe Checkout session for upgrading to Pro or Team.
 * Returns the Stripe Checkout URL.
 */
export const createCheckoutSession = internalAction({
  args: {
    userId: v.id("users"),
    email: v.string(),
    priceId: v.string(),
    successUrl: v.string(),
    cancelUrl: v.string(),
  },
  handler: async (ctx, { userId, email, priceId, successUrl, cancelUrl }): Promise<string> => {
    const stripe = getStripe();

    const existingSub = await ctx.runQuery(internal.billing.querySubscriptionByUserId, { userId });
    let customerId: string;

    // If the user already has an active subscription, upgrade it in-place rather
    // than creating a new Checkout session — that would stack subscriptions.
    if (
      existingSub?.stripeSubscriptionId &&
      (existingSub.status === "active" || existingSub.status === "trialing")
    ) {
      const subscription = await stripe.subscriptions.retrieve(existingSub.stripeSubscriptionId);
      const itemId = subscription.items.data[0]?.id;
      if (!itemId) throw new Error("No subscription item found on existing subscription");

      await stripe.subscriptions.update(existingSub.stripeSubscriptionId, {
        items: [{ id: itemId, price: priceId }],
        proration_behavior: "create_prorations",
      });

      // customer.subscription.updated webhook will sync the DB.
      // Return successUrl directly — no Stripe Checkout redirect needed.
      return successUrl;
    }

    if (existingSub) {
      customerId = existingSub.stripeCustomerId;
    } else {
      const customer = await stripe.customers.create({ email, metadata: { userId } });
      customerId = customer.id;
      await ctx.runMutation(internal.billing.upsertSubscription, {
        userId,
        stripeCustomerId: customerId,
        plan: "free",
        status: "active",
      });
    }

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: { userId },
      allow_promotion_codes: true,
    });

    if (!session.url) throw new Error("Stripe did not return a checkout URL");
    return session.url;
  },
});

/**
 * Create a Stripe Customer Portal session for managing existing subscription.
 */
export const createPortalSession = internalAction({
  args: {
    userId: v.id("users"),
    returnUrl: v.string(),
  },
  handler: async (ctx, { userId, returnUrl }): Promise<string> => {
    const stripe = getStripe();

    const sub = await ctx.runQuery(internal.billing.querySubscriptionByUserId, { userId });
    if (!sub) throw new Error("No billing record found. Please upgrade first.");

    const session = await stripe.billingPortal.sessions.create({
      customer: sub.stripeCustomerId,
      return_url: returnUrl,
    });

    return session.url;
  },
});

function planFromPriceId(priceId: string): "pro" | "team" {
  if (priceId === process.env.STRIPE_TEAM_PRICE_ID) return "team";
  return "pro";
}

function mapStripeStatus(
  status: Stripe.Subscription.Status
): "active" | "canceled" | "past_due" | "trialing" | "incomplete" {
  switch (status) {
    case "canceled": return "canceled";
    case "past_due": return "past_due";
    case "trialing": return "trialing";
    case "incomplete":
    case "incomplete_expired": return "incomplete";
    default: return "active";
  }
}

/**
 * Process a Stripe webhook event. Called from the HTTP action with the raw
 * request body and signature so that Stripe SDK verification + API calls
 * happen inside a Node.js action.
 */
export const processWebhook = internalAction({
  args: {
    body: v.string(),
    signature: v.string(),
  },
  handler: async (ctx, { body, signature }) => {
    const stripe = getStripe();
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!webhookSecret) throw new Error("Webhook secret not configured");

    const event = await stripe.webhooks.constructEventAsync(body, signature, webhookSecret);

    console.log(`[stripeWebhook] Processing: ${event.type}`);

    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.mode !== "subscription") break;

        const userId = session.metadata?.userId as Id<"users"> | undefined;
        if (!userId) {
          console.error("[stripeWebhook] No userId in checkout session metadata");
          break;
        }

        const subscriptionId = session.subscription as string;
        const subscription = await stripe.subscriptions.retrieve(subscriptionId);
        const priceId = subscription.items.data[0]?.price.id ?? "";
        const plan = planFromPriceId(priceId);
        const periodEnd = subscription.items.data[0]?.current_period_end ?? 0;

        await ctx.runMutation(internal.billing.upsertSubscription, {
          userId,
          stripeCustomerId: session.customer as string,
          stripeSubscriptionId: subscriptionId,
          plan,
          status: mapStripeStatus(subscription.status),
          currentPeriodEnd: periodEnd * 1000,
          cancelAtPeriodEnd: subscription.cancel_at_period_end,
        });

        console.log(`[stripeWebhook] Upgraded ${userId} → ${plan}`);
        break;
      }

      case "customer.subscription.updated": {
        const subscription = event.data.object as Stripe.Subscription;
        const sub = await ctx.runQuery(internal.billing.querySubscriptionByStripeSubId, {
          stripeSubscriptionId: subscription.id,
        });

        if (!sub) {
          console.warn(`[stripeWebhook] No local record for subscription ${subscription.id}`);
          break;
        }

        const priceId = subscription.items.data[0]?.price.id ?? "";
        const plan = planFromPriceId(priceId);
        const periodEnd = subscription.items.data[0]?.current_period_end ?? 0;

        await ctx.runMutation(internal.billing.upsertSubscription, {
          userId: sub.userId,
          stripeCustomerId: sub.stripeCustomerId,
          stripeSubscriptionId: subscription.id,
          plan,
          status: mapStripeStatus(subscription.status),
          currentPeriodEnd: periodEnd * 1000,
          cancelAtPeriodEnd: subscription.cancel_at_period_end,
        });
        break;
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        const sub = await ctx.runQuery(internal.billing.querySubscriptionByStripeSubId, {
          stripeSubscriptionId: subscription.id,
        });

        if (!sub) break;

        await ctx.runMutation(internal.billing.upsertSubscription, {
          userId: sub.userId,
          stripeCustomerId: sub.stripeCustomerId,
          stripeSubscriptionId: subscription.id,
          plan: "free",
          status: "canceled",
          currentPeriodEnd: undefined,
          cancelAtPeriodEnd: false,
        });

        console.log(`[stripeWebhook] Downgraded ${sub.userId} → free (subscription deleted)`);
        break;
      }

      default:
        console.log(`[stripeWebhook] Unhandled event: ${event.type}`);
    }
  },
});
