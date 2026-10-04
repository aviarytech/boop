import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";

/** Reuse the application's Resend transport and sender. A link is only a locator,
 * never authorization; opening it cannot accept or expose the resource. */
export const deliver = internalAction({
  args: { invitationId: v.id("listInvitations"), version: v.number() },
  handler: async (ctx, args): Promise<void> => {
    const payload = await ctx.runQuery(internal.invitations.deliveryPayload, args);
    if (!payload) return;
    let delivery: "sent" | "failed" = "failed";
    try {
      const key = process.env.RESEND_API_KEY;
      if (!key) throw new Error("Mail unavailable");
      const url = `https://boop.ad/invitations/${encodeURIComponent(args.invitationId)}/${args.version}`;
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "Idempotency-Key": `private-invitation/${args.invitationId}/${args.version}` },
        body: JSON.stringify({ from: "brian@boop.ad", to: payload.email,
          subject: "You have a private invitation on boop",
          text: `An account named ${JSON.stringify(payload.inviter)} invited you to collaborate on boop.\n\nSign in with this email address to review and explicitly accept your invitation. Invitations expire after seven days.\n\n${url}\n\nYou can also find pending invitations in boop after signing in.`,
        }),
      });
      if (response.ok) delivery = "sent";
    } catch {
      // Do not persist provider responses (which may expose account/delivery details).
    }
    await ctx.runMutation(internal.invitations.deliveryResult, { ...args, delivery });
  },
});
