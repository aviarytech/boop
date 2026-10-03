"use node";
/**
 * Push notification actions (Node.js) — APNs + Web Push.
 * Queries/mutations are in notifications.ts.
 */

import { v } from "convex/values";
import { action, internalAction } from "./_generated/server";
import { internal } from "./_generated/api";

// ─── Send push notification (action) ────────────────────────────────

export const sendPushNotification = action({
  args: {
    userDid: v.string(),
    title: v.string(),
    body: v.string(),
    data: v.optional(v.any()),
  },
  handler: async (ctx, args): Promise<Array<{ token: string; platform: string; status: string; reason?: string }>> => {
    const tokens: Array<{ token: string; platform: string; webPushKeys?: { p256dh: string; auth: string } }> = await ctx.runQuery(internal.notifications.getTokensForUser, {
      userDid: args.userDid,
    });

    const results: PromiseSettledResult<void>[] = await Promise.allSettled(
      tokens.map((tok: { token: string; platform: string; webPushKeys?: { p256dh: string; auth: string } }) => {
        if (tok.platform === "ios") {
          return sendAPNs(args.title, args.body, args.data, tok.token);
        } else {
          return sendWebPush(args.title, args.body, args.data, tok.token, tok.webPushKeys!);
        }
      })
    );

    return results.map((r: PromiseSettledResult<void>, i: number) => ({
      token: tokens[i].token.substring(0, 10) + "...",
      platform: tokens[i].platform,
      status: r.status,
      reason: r.status === "rejected" ? String(r.reason) : undefined,
    }));
  },
});

export const sendListNotification = action({
  args: {
    listId: v.id("lists"),
    excludeDid: v.optional(v.string()),
    title: v.string(),
    body: v.string(),
    data: v.optional(v.any()),
  },
  handler: async (ctx, args): Promise<Array<{ platform: string; status: string }>> => {
    type TokenRecord = { userDid: string; token: string; platform: string; webPushKeys?: { p256dh: string; auth: string } };
    const tokens: TokenRecord[] = await ctx.runQuery(internal.notifications.getTokensForList, {
      listId: args.listId,
    });

    const filtered: TokenRecord[] = args.excludeDid
      ? tokens.filter((t: TokenRecord) => t.userDid !== args.excludeDid)
      : tokens;

    const results: PromiseSettledResult<void>[] = await Promise.allSettled(
      filtered.map((tok: TokenRecord) => {
        if (tok.platform === "ios") {
          return sendAPNs(args.title, args.body, args.data, tok.token);
        } else {
          return sendWebPush(args.title, args.body, args.data, tok.token, tok.webPushKeys!);
        }
      })
    );

    return results.map((r: PromiseSettledResult<void>, i: number) => ({
      platform: filtered[i].platform,
      status: r.status,
    }));
  },
});

// ─── Internal variants (for scheduling from mutations) ──────────────

export const sendPushNotificationInternal = internalAction({
  args: {
    userDid: v.string(),
    title: v.string(),
    body: v.string(),
    data: v.optional(v.any()),
  },
  handler: async (ctx, args): Promise<void> => {
    const tokens: Array<{ token: string; platform: string; webPushKeys?: { p256dh: string; auth: string } }> = await ctx.runQuery(internal.notifications.getTokensForUser, {
      userDid: args.userDid,
    });

    await Promise.allSettled(
      tokens.map((tok) => {
        if (tok.platform === "ios") {
          return sendAPNs(args.title, args.body, args.data, tok.token);
        } else {
          return sendWebPush(args.title, args.body, args.data, tok.token, tok.webPushKeys!);
        }
      })
    );
  },
});

export const sendListNotificationInternal = internalAction({
  args: {
    listId: v.id("lists"),
    excludeDid: v.optional(v.string()),
    title: v.string(),
    body: v.string(),
    data: v.optional(v.any()),
  },
  handler: async (ctx, args): Promise<void> => {
    type TokenRecord = { userDid: string; token: string; platform: string; webPushKeys?: { p256dh: string; auth: string } };
    const tokens: TokenRecord[] = await ctx.runQuery(internal.notifications.getTokensForList, {
      listId: args.listId,
    });

    const filtered = args.excludeDid
      ? tokens.filter((t) => t.userDid !== args.excludeDid)
      : tokens;

    await Promise.allSettled(
      filtered.map((tok) => {
        if (tok.platform === "ios") {
          return sendAPNs(args.title, args.body, args.data, tok.token);
        } else {
          return sendWebPush(args.title, args.body, args.data, tok.token, tok.webPushKeys!);
        }
      })
    );
  },
});

// ─── APNs HTTP/2 sender ─────────────────────────────────────────────

async function createAPNsJWT(): Promise<string> {
  const keyId = process.env.APNS_KEY_ID!;
  const teamId = process.env.APNS_TEAM_ID!;
  const privateKeyPem = process.env.APNS_PRIVATE_KEY!;

  const pemBody = privateKeyPem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s/g, "");
  const keyBytes = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0));

  const key = await crypto.subtle.importKey(
    "pkcs8",
    keyBytes.buffer,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"]
  );

  const header = { alg: "ES256", kid: keyId };
  const payload = { iss: teamId, iat: Math.floor(Date.now() / 1000) };

  const encode = (obj: unknown) =>
    btoa(JSON.stringify(obj))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

  const headerB64 = encode(header);
  const payloadB64 = encode(payload);
  const signingInput = `${headerB64}.${payloadB64}`;

  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    new TextEncoder().encode(signingInput)
  );

  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  return `${signingInput}.${sigB64}`;
}

async function sendAPNs(
  title: string,
  body: string,
  data: unknown,
  deviceToken: string
): Promise<void> {
  const bundleId = process.env.APNS_BUNDLE_ID!;
  const jwt = await createAPNsJWT();

  const url = `https://api.push.apple.com/3/device/${deviceToken}`;

  const apnsPayload = {
    aps: {
      alert: { title, body },
      sound: "default",
      badge: 1,
    },
    ...(data && typeof data === "object" ? data : {}),
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `bearer ${jwt}`,
      "apns-topic": bundleId,
      "apns-push-type": "alert",
      "apns-priority": "10",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(apnsPayload),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`APNs error ${res.status}: ${text}`);
  }
}

// ─── Web Push (VAPID) sender ────────────────────────────────────────

async function sendWebPush(
  title: string,
  body: string,
  data: unknown,
  endpoint: string,
  keys: { p256dh: string; auth: string }
): Promise<void> {
  const vapidPublicKey = process.env.VAPID_PUBLIC_KEY!;
  const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY!;

  const payload = JSON.stringify({ title, body, data });

  const webpush = await import("web-push");

  webpush.setVapidDetails(
    "mailto:kgbot007@icloud.com",
    vapidPublicKey,
    vapidPrivateKey
  );

  await webpush.sendNotification(
    {
      endpoint,
      keys: {
        p256dh: keys.p256dh,
        auth: keys.auth,
      },
    },
    payload
  );
}
