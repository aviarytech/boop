"use node";

import { action, internalAction } from "./_generated/server";
import { internal, api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { createCustomHostname, getCustomHostname } from "./cloudflare";
import { getObjectBody, headObject } from "./lib/bucket";
import { createHash, createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { sha512 } from "@noble/hashes/sha2.js";
import { concatBytes, bytesToHex } from "@noble/hashes/utils.js";
import * as ed25519 from "@noble/ed25519";
import {
  createDID,
  updateDID,
  MultibaseEncoding,
  multibaseEncode,
  prepareDataForSigning,
} from "didwebvh-ts";
import type { SigningInput, SigningOutput } from "didwebvh-ts";

const ADJECTIVES = [
  "brisk",
  "cosmic",
  "dapper",
  "fizzy",
  "gentle",
  "lucky",
  "merry",
  "tiny",
];

const NOUNS = [
  "paper",
  "button",
  "garden",
  "lantern",
  "signal",
  "window",
  "studio",
  "sketch",
];

const ED25519_MULTICODEC_PREFIX = new Uint8Array([0xed, 0x01]);
// Convex Node action args support up to 5 MiB. Keep some headroom for
// metadata and JSON encoding until the UI switches to direct upload URLs.
const MAX_HTML_BYTES = 4 * 1024 * 1024;

function configureEd25519Sha512() {
  const sha512Fn = (...messages: Uint8Array[]) => sha512(concatBytes(...messages));
  const module = ed25519 as unknown as {
    utils?: { sha512Sync?: (...messages: Uint8Array[]) => Uint8Array };
    etc?: { sha512Sync?: (...messages: Uint8Array[]) => Uint8Array };
  };
  if (module.utils) module.utils.sha512Sync = sha512Fn;
  if (module.etc) module.etc.sha512Sync = sha512Fn;
}

class SiteWebVHSigner {
  private readonly privateKey: Uint8Array;
  private readonly publicKeyMultibase: string;

  constructor(privateKey: Uint8Array, publicKeyMultibase: string) {
    this.privateKey = privateKey;
    this.publicKeyMultibase = publicKeyMultibase;
  }

  getVerificationMethodId() {
    return `did:key:${this.publicKeyMultibase}`;
  }

  async sign(input: SigningInput): Promise<SigningOutput> {
    const payload = await prepareDataForSigning(
      input.document as Record<string, unknown>,
      input.proof
    );
    const signature = await ed25519.signAsync(payload, this.privateKey);
    return {
      proofValue: multibaseEncode(signature, MultibaseEncoding.BASE58_BTC),
    };
  }

  async verify(
    signature: Uint8Array,
    message: Uint8Array,
    publicKey: Uint8Array
  ): Promise<boolean> {
    const key = publicKey.length === 33 ? publicKey.slice(1) : publicKey;
    return ed25519.verifyAsync(signature, message, key);
  }
}

function validateHtmlPayload(html: string): string {
  const trimmed = html.trim();
  if (!trimmed) {
    throw new Error("Drop a little HTML first.");
  }
  const byteLength = new TextEncoder().encode(trimmed).byteLength;
  if (byteLength > MAX_HTML_BYTES) {
    throw new Error("That file is a bit too mighty for v1.");
  }
  return trimmed;
}

function safeLabel(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");
}

function normalizeBaseDomain(baseDomain: string): string {
  return baseDomain
    .replace(/^https?:\/\//i, "")
    .split("/")[0]
    .split(":")[0]
    .trim()
    .toLowerCase();
}

function randomChoice(values: string[]): string {
  return values[randomBytes(1)[0] % values.length];
}

function randomDigits(): string {
  return String(randomBytes(1)[0] % 100).padStart(2, "0");
}

function buildHostname(baseDomain: string): string {
  const normalizedBaseDomain = normalizeBaseDomain(baseDomain);
  return `${safeLabel(randomChoice(ADJECTIVES))}-${safeLabel(
    randomChoice(NOUNS)
  )}-${randomDigits()}.${normalizedBaseDomain}`;
}

function encryptionKey(secret: string): Buffer {
  return createHash("sha256").update(secret).digest();
}

function encryptPrivateKey(privateKey: Uint8Array, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(secret), iv);
  const ciphertext = Buffer.concat([
    cipher.update(Buffer.from(bytesToHex(privateKey), "utf8")),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [
    iv.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

function decryptPrivateKey(encryptedPrivateKey: string, secret: string): Uint8Array {
  const [ivBase64, tagBase64, ciphertextBase64] = encryptedPrivateKey.split(".");
  if (!ivBase64 || !tagBase64 || !ciphertextBase64) {
    throw new Error("Stored site key is malformed");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(secret),
    Buffer.from(ivBase64, "base64url")
  );
  decipher.setAuthTag(Buffer.from(tagBase64, "base64url"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertextBase64, "base64url")),
    decipher.final(),
  ]).toString("utf8");
  return new Uint8Array(Buffer.from(plaintext, "hex"));
}

async function createSiteKey() {
  const privateKey = ed25519.utils.randomSecretKey();
  const publicKey = await ed25519.getPublicKeyAsync(privateKey);
  const prefixed = new Uint8Array(ED25519_MULTICODEC_PREFIX.length + publicKey.length);
  prefixed.set(ED25519_MULTICODEC_PREFIX, 0);
  prefixed.set(publicKey, ED25519_MULTICODEC_PREFIX.length);
  const publicKeyMultibase = multibaseEncode(
    prefixed,
    MultibaseEncoding.BASE58_BTC
  );
  return { privateKey, publicKeyMultibase };
}

function serializeDidLogEntries(log: Array<{ versionId: string; versionTime: string }>) {
  return log.map((entry) => ({
    versionId: entry.versionId,
    entryJsonl: JSON.stringify(entry),
    signedAt: Date.parse(String(entry.versionTime)) || Date.now(),
  }));
}

function normalizeCustomHostname(hostname: string): string {
  const normalized = hostname
    .replace(/^https?:\/\//i, "")
    .split("/")[0]
    .split(":")[0]
    .trim()
    .toLowerCase();

  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(normalized)) {
    throw new Error("Enter a real domain, like www.forexample.com.");
  }

  return normalized;
}

export const createSiteFromUpload = action({
  args: {
    ownerDid: v.string(),
    bucketKey: v.string(),
  },
  handler: async (ctx, args): Promise<{ siteId: string; hostname: string; url: string; did: string; scid: string }> => {
    configureEd25519Sha512();

    const baseDomain = process.env.SITE_BASE_DOMAIN || process.env.WEBVH_DOMAIN || "boop.ad";
    const encryptionSecret = process.env.SITE_KEY_ENCRYPTION_SECRET;
    if (!encryptionSecret) {
      throw new Error("SITE_KEY_ENCRYPTION_SECRET is not configured");
    }

    const head = await headObject(args.bucketKey);
    if (!head.exists) {
      throw new Error("That uploaded file disappeared. Try dropping it again.");
    }

    const blob = await getObjectBody(args.bucketKey);
    const content = validateHtmlPayload(await blob.text());
    const byteLength = new TextEncoder().encode(content).byteLength;
    const sha256 = createHash("sha256").update(content).digest("hex");

    let hostname = "";
    for (let attempt = 0; attempt < 25; attempt += 1) {
      const candidate = buildHostname(baseDomain);
      const available = await ctx.runQuery(internal.siteInternals.isHostnameAvailable, {
        hostname: candidate,
      });
      if (available) {
        hostname = candidate;
        break;
      }
    }
    if (!hostname) {
      throw new Error("Could not find an available boop link. Try again in a moment.");
    }

    const { privateKey, publicKeyMultibase } = await createSiteKey();
    const signer = new SiteWebVHSigner(privateKey, publicKeyMultibase);

    const didResult = await createDID({
      domain: hostname,
      signer,
      verifier: signer,
  // Bare multibase, not the did:key URI — see lib/webvh.ts (didwebvh-ts 2.8
      // compares updateKeys against the parsed keyMultibase by exact equality).
      updateKeys: [publicKeyMultibase],
      verificationMethods: [
        {
          id: "#key-0",
          type: "Multikey",
          controller: "",
          publicKeyMultibase,
        },
      ],
      portable: true,
      authentication: ["#key-0"],
      assertionMethod: ["#key-0"],
    });

    const scid = didResult.log[0]?.parameters?.scid;
    if (!scid) {
      throw new Error("DID creation did not return a SCID");
    }

    const createdAt = Date.now();
    const record = await ctx.runMutation(internal.siteInternals.createSiteRecord, {
      ownerDid: args.ownerDid,
      bucketKey: args.bucketKey,
      contentType: "text/html; charset=utf-8",
      sha256,
      byteLength,
      hostname,
      did: didResult.did,
      scid,
      publicKeyMultibase,
      encryptedPrivateKey: encryptPrivateKey(privateKey, encryptionSecret),
      didLogEntries: serializeDidLogEntries(didResult.log),
      createdAt,
    });

    return {
      siteId: record.siteId,
      hostname,
      url: `https://${hostname}`,
      did: didResult.did,
      scid,
    };
  },
});

export const createSite = action({
  args: {
    ownerDid: v.string(),
    html: v.string(),
  },
  handler: async (): Promise<never> => {
    throw new Error("Use direct upload for sites. Refresh and drop the file again.");
  },
});

export const migrateVerifiedCustomDomain = action({
  args: {
    ownerDid: v.string(),
    siteId: v.id("sites"),
    hostname: v.string(),
  },
  handler: async (ctx, args): Promise<{ siteId: string; hostname: string; did: string; scid: string }> => {
    configureEd25519Sha512();

    const encryptionSecret = process.env.SITE_KEY_ENCRYPTION_SECRET;
    if (!encryptionSecret) {
      throw new Error("SITE_KEY_ENCRYPTION_SECRET is not configured");
    }

    const hostname = normalizeCustomHostname(args.hostname);
    const record = await ctx.runQuery(internal.siteInternals.getSiteIdentityForUpdate, {
      siteId: args.siteId,
      ownerDid: args.ownerDid,
    });
    if (!record) {
      throw new Error("Site not found");
    }

    const privateKey = decryptPrivateKey(
      record.key.encryptedPrivateKey,
      encryptionSecret
    );
    const signer = new SiteWebVHSigner(privateKey, record.key.publicKeyMultibase);
    const migratedDid = `did:webvh:${record.site.scid}:${hostname}`;
    const currentLog = record.didLogEntries.map((entry) => JSON.parse(entry.entryJsonl));

    const migrated = await updateDID({
      log: currentLog,
      signer,
      verifier: signer,
      domain: hostname,
      controller: migratedDid,
  // Bare multibase, not the did:key URI — see lib/webvh.ts (didwebvh-ts 2.8
      // compares updateKeys against the parsed keyMultibase by exact equality).
      updateKeys: [record.key.publicKeyMultibase],
      verificationMethods: [
        {
          id: "#key-0",
          type: "Multikey",
          controller: "",
          publicKeyMultibase: record.key.publicKeyMultibase,
        },
      ],
      portable: true,
      authentication: ["#key-0"],
      assertionMethod: ["#key-0"],
      witnessProofs: [],
    });

    if (migrated.meta.scid !== record.site.scid) {
      throw new Error("DID migration changed the SCID; refusing to continue.");
    }

    const latestEntry = migrated.log[migrated.log.length - 1];
    if (!latestEntry) {
      throw new Error("DID migration did not return a log entry.");
    }

    const updatedAt = Date.now();
    await ctx.runMutation(internal.siteInternals.applyDomainMigration, {
      siteId: args.siteId,
      hostname,
      did: migrated.did,
      didLogEntry: {
        versionId: latestEntry.versionId,
        entryJsonl: JSON.stringify(latestEntry),
        signedAt: Date.parse(latestEntry.versionTime) || updatedAt,
      },
      updatedAt,
    });

    return {
      siteId: args.siteId,
      hostname,
      did: migrated.did,
      scid: record.site.scid,
    };
  },
});

function normalizeRequestedHostname(input: string): string {
  const lowered = input.trim().toLowerCase().replace(/\.$/, "");
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(lowered)) {
    throw new Error("That doesn't look like a valid hostname. Try something like www.example.com.");
  }
  return lowered;
}

export const requestCustomHostname = action({
  args: {
    ownerDid: v.string(),
    siteId: v.id("sites"),
    hostname: v.string(),
  },
  handler: async (ctx, args): Promise<{ hostnameId: Id<"siteHostnames">; cfHostnameId: string }> => {
    const hostname = normalizeRequestedHostname(args.hostname);

    const record = await ctx.runQuery(
      internal.siteInternals.getSiteIdentityForUpdate,
      { siteId: args.siteId, ownerDid: args.ownerDid }
    );
    if (!record) {
      throw new Error("Site not found");
    }

    const cfRecord = await createCustomHostname(hostname);

    const hostnameId: Id<"siteHostnames"> = await ctx.runMutation(
      internal.siteInternals.recordCustomHostnameRequest,
      {
        siteId: args.siteId,
        hostname,
        cfHostnameId: cfRecord.id,
        cfStatus: cfRecord.status,
        cfSslStatus: cfRecord.ssl.status,
        now: Date.now(),
      }
    );

    return { hostnameId, cfHostnameId: cfRecord.id };
  },
});

const PENDING_TIMEOUT_MS = 24 * 60 * 60 * 1000; // 24 hours

export const pollCustomHostname = internalAction({
  args: { hostnameId: v.id("siteHostnames") },
  handler: async (ctx, args): Promise<void> => {
    const row = await ctx.runQuery(internal.siteInternals.getHostname, {
      hostnameId: args.hostnameId,
    });
    if (!row || row.kind !== "custom" || !row.cfHostnameId || row.status === "active") {
      return;
    }

    let cfRecord;
    try {
      cfRecord = await getCustomHostname(row.cfHostnameId);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Cloudflare poll failed";
      await ctx.runMutation(internal.siteInternals.updateHostnameVerification, {
        hostnameId: args.hostnameId,
        cfStatus: row.cfStatus ?? "pending",
        cfSslStatus: row.cfSslStatus ?? "initializing",
        verificationErrors: [message],
        now: Date.now(),
      });
      return;
    }

    const now = Date.now();
    const errors: string[] = [];
    if (cfRecord.verification_errors && cfRecord.verification_errors.length > 0) {
      errors.push(...cfRecord.verification_errors);
    }
    if (
      cfRecord.status === "pending" &&
      now - row.createdAt > PENDING_TIMEOUT_MS
    ) {
      errors.push(
        `Timed out waiting for DNS verification. Check the CNAME at ${row.hostname}.`
      );
    }

    await ctx.runMutation(internal.siteInternals.updateHostnameVerification, {
      hostnameId: args.hostnameId,
      cfStatus: cfRecord.status,
      cfSslStatus: cfRecord.ssl.status,
      verificationErrors: errors,
      now,
    });

    const verified = cfRecord.status === "active" && cfRecord.ssl.status === "active";
    if (verified && row.status === "pending") {
      const owner = await ctx.runQuery(internal.siteInternals.getSiteOwner, {
        siteId: row.siteId,
      });
      if (!owner) return;
      try {
        await ctx.runAction(api.siteActions.migrateVerifiedCustomDomain, {
          ownerDid: owner.ownerDid,
          siteId: row.siteId,
          hostname: row.hostname,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "DID migration failed";
        await ctx.runMutation(internal.siteInternals.updateHostnameVerification, {
          hostnameId: args.hostnameId,
          cfStatus: cfRecord.status,
          cfSslStatus: cfRecord.ssl.status,
          verificationErrors: [...errors, message],
          now: Date.now(),
        });
      }
    }
  },
});

export const pollPendingCustomHostnames = internalAction({
  args: {},
  handler: async (ctx): Promise<void> => {
    const rows = await ctx.runQuery(
      internal.siteInternals.listPendingCustomHostnames,
      {}
    );
    for (const row of rows) {
      await ctx.scheduler.runAfter(0, internal.siteActions.pollCustomHostname, {
        hostnameId: row._id,
      });
    }
  },
});

const MAX_REPLACE_HTML_BYTES = 2 * 1024 * 1024; // 2 MB

export const replaceSiteFile = action({
  args: {
    ownerDid: v.string(),
    siteId: v.id("sites"),
    bucketKey: v.string(),
  },
  handler: async (ctx, args): Promise<{ fileId: string }> => {
    // Ownership check via the existing query.
    const owned = await ctx.runQuery(internal.siteInternals.getSiteIdentityForUpdate, {
      siteId: args.siteId,
      ownerDid: args.ownerDid,
    });
    if (!owned) throw new Error("Site not found");

    const head = await headObject(args.bucketKey);
    if (!head.exists) throw new Error("Uploaded file not found.");
    if (!head.contentLength || head.contentLength === 0) {
      throw new Error("The uploaded file was empty.");
    }
    if (head.contentLength > MAX_REPLACE_HTML_BYTES) {
      throw new Error("That file is bigger than the 2 MB limit.");
    }

    const blob = await getObjectBody(args.bucketKey);
    const buffer = await blob.arrayBuffer();
    const byteLength = buffer.byteLength;
    const contentType = head.contentType ?? "text/html; charset=utf-8";

    const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
    const sha256 = Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    const result: { fileId: string } = await ctx.runMutation(
      internal.siteInternals.replaceSiteFileRecord,
      {
        siteId: args.siteId,
        bucketKey: args.bucketKey,
        contentType,
        sha256,
        byteLength,
        now: Date.now(),
      }
    );
    return result;
  },
});

export const retryCustomHostname = action({
  args: {
    ownerDid: v.string(),
    hostnameId: v.id("siteHostnames"),
  },
  handler: async (ctx, args): Promise<void> => {
    const row = await ctx.runQuery(internal.siteInternals.getHostname, {
      hostnameId: args.hostnameId,
    });
    if (!row) throw new Error("Hostname not found");

    // Verify the caller owns the site this hostname belongs to.
    const owner = await ctx.runQuery(internal.siteInternals.getSiteOwner, {
      siteId: row.siteId,
    });
    if (!owner || owner.ownerDid !== args.ownerDid) {
      throw new Error("Not authorized");
    }

    // Clear errors so the cron picks the row back up, and kick an immediate poll.
    await ctx.runMutation(internal.siteInternals.clearHostnameErrors, {
      hostnameId: args.hostnameId,
      now: Date.now(),
    });
    await ctx.scheduler.runAfter(0, internal.siteActions.pollCustomHostname, {
      hostnameId: args.hostnameId,
    });
  },
});
