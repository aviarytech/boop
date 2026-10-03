import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

export const isHostnameAvailable = internalQuery({
  args: { hostname: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("siteHostnames")
      .withIndex("by_hostname", (q) => q.eq("hostname", args.hostname))
      .first();
    return existing == null;
  },
});

export const createSiteRecord = internalMutation({
  args: {
    ownerDid: v.string(),
    bucketKey: v.string(),
    contentType: v.string(),
    sha256: v.string(),
    byteLength: v.number(),
    hostname: v.string(),
    did: v.string(),
    scid: v.string(),
    publicKeyMultibase: v.string(),
    encryptedPrivateKey: v.string(),
    didLogEntries: v.array(
      v.object({
        versionId: v.string(),
        entryJsonl: v.string(),
        signedAt: v.number(),
      })
    ),
    createdAt: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("siteHostnames")
      .withIndex("by_hostname", (q) => q.eq("hostname", args.hostname))
      .first();
    if (existing) {
      throw new Error("That boop link was just taken. Try again.");
    }

    const fileId = await ctx.db.insert("siteFiles", {
      bucketKey: args.bucketKey,
      contentType: args.contentType,
      sha256: args.sha256,
      byteLength: args.byteLength,
      createdAt: args.createdAt,
    });

    const siteId = await ctx.db.insert("sites", {
      ownerDid: args.ownerDid,
      scid: args.scid,
      did: args.did,
      fileId,
      createdAt: args.createdAt,
      updatedAt: args.createdAt,
    });

    const hostnameId = await ctx.db.insert("siteHostnames", {
      siteId,
      hostname: args.hostname,
      kind: "boop_sub",
      status: "active",
      isPrimary: true,
      createdAt: args.createdAt,
      updatedAt: args.createdAt,
    });

    await ctx.db.patch(siteId, { primaryHostnameId: hostnameId });

    await ctx.db.insert("siteKeys", {
      siteId,
      keyType: "ed25519",
      publicKeyMultibase: args.publicKeyMultibase,
      encryptedPrivateKey: args.encryptedPrivateKey,
      createdAt: args.createdAt,
    });

    for (const entry of args.didLogEntries) {
      await ctx.db.insert("siteDidLogEntries", {
        siteId,
        versionId: entry.versionId,
        entryJsonl: entry.entryJsonl,
        signedAt: entry.signedAt,
      });
    }

    return { siteId, hostnameId, fileId };
  },
});


export const getSiteIdentityForUpdate = internalQuery({
  args: {
    siteId: v.id("sites"),
    ownerDid: v.string(),
  },
  handler: async (ctx, args) => {
    const site = await ctx.db.get(args.siteId);
    if (!site || site.ownerDid !== args.ownerDid) return null;

    const [key, hostnames, didLogEntries] = await Promise.all([
      ctx.db
        .query("siteKeys")
        .withIndex("by_site", (q) => q.eq("siteId", site._id))
        .first(),
      ctx.db
        .query("siteHostnames")
        .withIndex("by_site", (q) => q.eq("siteId", site._id))
        .collect(),
      ctx.db
        .query("siteDidLogEntries")
        .withIndex("by_site", (q) => q.eq("siteId", site._id))
        .collect(),
    ]);

    if (!key) return null;

    return {
      site,
      key,
      hostnames,
      didLogEntries: didLogEntries.sort((a, b) => a.signedAt - b.signedAt),
    };
  },
});

export const applyDomainMigration = internalMutation({
  args: {
    siteId: v.id("sites"),
    hostname: v.string(),
    did: v.string(),
    didLogEntry: v.object({
      versionId: v.string(),
      entryJsonl: v.string(),
      signedAt: v.number(),
    }),
    updatedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const site = await ctx.db.get(args.siteId);
    if (!site) throw new Error("Site not found");

    const existing = await ctx.db
      .query("siteHostnames")
      .withIndex("by_hostname", (q) => q.eq("hostname", args.hostname))
      .first();
    if (existing && existing.siteId !== args.siteId) {
      throw new Error("That domain is already connected to another boop site.");
    }

    const hostnames = await ctx.db
      .query("siteHostnames")
      .withIndex("by_site", (q) => q.eq("siteId", args.siteId))
      .collect();

    for (const hostname of hostnames) {
      if (hostname.hostname === args.hostname) {
        await ctx.db.patch(hostname._id, {
          status: "active",
          isPrimary: true,
          redirectTo: undefined,
          updatedAt: args.updatedAt,
        });
      } else {
        await ctx.db.patch(hostname._id, {
          status: hostname.kind === "boop_sub" ? "redirected" : hostname.status,
          isPrimary: false,
          redirectTo: args.hostname,
          updatedAt: args.updatedAt,
        });
      }
    }

    let customHostnameId = existing?._id;
    if (!customHostnameId) {
      customHostnameId = await ctx.db.insert("siteHostnames", {
        siteId: args.siteId,
        hostname: args.hostname,
        kind: "custom",
        status: "active",
        isPrimary: true,
        createdAt: args.updatedAt,
        updatedAt: args.updatedAt,
      });
    }

    await ctx.db.insert("siteDidLogEntries", {
      siteId: args.siteId,
      versionId: args.didLogEntry.versionId,
      entryJsonl: args.didLogEntry.entryJsonl,
      signedAt: args.didLogEntry.signedAt,
    });

    await ctx.db.patch(args.siteId, {
      did: args.did,
      primaryHostnameId: customHostnameId,
      updatedAt: args.updatedAt,
    });

    return { siteId: args.siteId, hostnameId: customHostnameId };
  },
});

export const recordCustomHostnameRequest = internalMutation({
  args: {
    siteId: v.id("sites"),
    hostname: v.string(),
    cfHostnameId: v.string(),
    cfStatus: v.union(
      v.literal("pending"),
      v.literal("active"),
      v.literal("blocked"),
      v.literal("moved"),
      v.literal("deleted"),
    ),
    cfSslStatus: v.union(
      v.literal("initializing"),
      v.literal("pending_validation"),
      v.literal("pending_issuance"),
      v.literal("pending_deployment"),
      v.literal("active"),
      v.literal("expired"),
      v.literal("deleted"),
    ),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("siteHostnames")
      .withIndex("by_hostname", (q) => q.eq("hostname", args.hostname))
      .first();
    if (existing) {
      throw new Error("That domain is already connected to another boop site.");
    }
    const id = await ctx.db.insert("siteHostnames", {
      siteId: args.siteId,
      hostname: args.hostname,
      kind: "custom",
      status: "pending",
      isPrimary: false,
      cfHostnameId: args.cfHostnameId,
      cfStatus: args.cfStatus,
      cfSslStatus: args.cfSslStatus,
      verificationErrors: [],
      lastCheckedAt: args.now,
      createdAt: args.now,
      updatedAt: args.now,
    });
    return id;
  },
});

export const updateHostnameVerification = internalMutation({
  args: {
    hostnameId: v.id("siteHostnames"),
    cfStatus: v.union(
      v.literal("pending"),
      v.literal("active"),
      v.literal("blocked"),
      v.literal("moved"),
      v.literal("deleted"),
    ),
    cfSslStatus: v.union(
      v.literal("initializing"),
      v.literal("pending_validation"),
      v.literal("pending_issuance"),
      v.literal("pending_deployment"),
      v.literal("active"),
      v.literal("expired"),
      v.literal("deleted"),
    ),
    verificationErrors: v.array(v.string()),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.hostnameId, {
      cfStatus: args.cfStatus,
      cfSslStatus: args.cfSslStatus,
      verificationErrors: args.verificationErrors,
      lastCheckedAt: args.now,
      updatedAt: args.now,
    });
  },
});

export const listPendingCustomHostnames = internalQuery({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db.query("siteHostnames").collect();
    return all.filter(
      (h) =>
        h.kind === "custom" &&
        h.status === "pending" &&
        h.cfHostnameId !== undefined &&
        (h.verificationErrors === undefined || h.verificationErrors.length === 0),
    );
  },
});

export const getHostname = internalQuery({
  args: { hostnameId: v.id("siteHostnames") },
  handler: async (ctx, args) => {
    return ctx.db.get(args.hostnameId);
  },
});

export const getSiteOwner = internalQuery({
  args: { siteId: v.id("sites") },
  handler: async (ctx, args) => {
    const site = await ctx.db.get(args.siteId);
    return site ? { ownerDid: site.ownerDid } : null;
  },
});

export const clearHostnameErrors = internalMutation({
  args: { hostnameId: v.id("siteHostnames"), now: v.number() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.hostnameId, {
      verificationErrors: [],
      lastCheckedAt: args.now,
      updatedAt: args.now,
    });
  },
});

export const replaceSiteFileRecord = internalMutation({
  args: {
    siteId: v.id("sites"),
    bucketKey: v.string(),
    contentType: v.string(),
    sha256: v.string(),
    byteLength: v.number(),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    const site = await ctx.db.get(args.siteId);
    if (!site) throw new Error("Site not found");

    const newFileId = await ctx.db.insert("siteFiles", {
      bucketKey: args.bucketKey,
      contentType: args.contentType,
      sha256: args.sha256,
      byteLength: args.byteLength,
      createdAt: args.now,
    });

    await ctx.db.patch(args.siteId, {
      fileId: newFileId,
      updatedAt: args.now,
    });

    return { fileId: newFileId };
  },
});
