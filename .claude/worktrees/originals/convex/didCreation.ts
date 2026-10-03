"use node";

/**
 * Server-side DID creation using Turnkey and OriginalsSDK.
 *
 * This "use node" action creates did:webvh identities:
 * - Internal action for OTP verification (user DID)
 * - Public action for list publication (list DID)
 */

import { action, internalAction } from "./_generated/server";
import { v } from "convex/values";
import { TurnkeyWebVHSigner } from "./lib/turnkeySigner";
import { getEd25519Account } from "./turnkeyHelpers";
import { createDID as createWebVHDID } from "didwebvh-ts";

/**
 * Internal helper to create a did:webvh DID.
 */
async function createDIDRecord(
  subOrgId: string,
  domain: string,
  slug: string
): Promise<{ did: string; didDocument: unknown; didLog: unknown }> {
  const { turnkeyClient, address, verificationMethodId, signingOrganizationId } =
    await getEd25519Account(subOrgId);

  // Create server-side signer
  const signer = new TurnkeyWebVHSigner(
    signingOrganizationId,
    address, // keyId = address for signWith
    address, // publicKeyMultibase (matches client-side convention)
    turnkeyClient,
    verificationMethodId
  );

  const result = await createWebVHDID({
    domain,
    signer,
    verifier: signer,
    // Bare multibase, not the did:key URI — see lib/webvh.ts (didwebvh-ts 2.8
    // compares updateKeys against the parsed keyMultibase by exact equality).
    updateKeys: [address],
    verificationMethods: [
      {
        id: "#key-0",
        type: "Multikey",
        controller: "",
        publicKeyMultibase: address,
      },
      {
        id: "#key-1",
        type: "Multikey",
        controller: "",
        publicKeyMultibase: address,
      },
    ],
    paths: [slug],
    portable: false,
    authentication: ["#key-0"],
    assertionMethod: ["#key-1"],
  });

  return { did: result.did, didDocument: result.doc, didLog: result.log };
}

/**
 * Create a did:webvh DID for a user during OTP verification.
 * Internal action - called from HTTP auth endpoint.
 */
export const createDIDWebVH = internalAction({
  args: {
    subOrgId: v.string(),
    email: v.string(),
  },
  handler: async (_ctx, args): Promise<{ did: string }> => {
    const domain = process.env.WEBVH_DOMAIN;
    if (!domain) {
      throw new Error("WEBVH_DOMAIN environment variable is not set");
    }

    console.log(
      `[didCreation] Creating user did:webvh for ${args.email} (subOrg: ${args.subOrgId})`
    );

    // Use subOrgId only — no PII in the DID
    const slug = `user-${args.subOrgId.slice(0, 16)}`;

    const result = await createDIDRecord(args.subOrgId, domain, slug);

    console.log(`[didCreation] Created user did:webvh: ${result.did}`);
    return { did: result.did };
  },
});

/**
 * Create a did:key DID for a user from their Turnkey Ed25519 account.
 * Internal action - used when server-side did:webvh signing is disabled.
 */
export const createDIDKey = internalAction({
  args: {
    subOrgId: v.string(),
  },
  handler: async (_ctx, args): Promise<{ did: string }> => {
    const { verificationMethodId } = await getEd25519Account(args.subOrgId);
    return { did: verificationMethodId };
  },
});

/**
 * Create a did:webvh DID for list publication.
 * Public action - called from client when publishing a list.
 */
export const createListDID = action({
  args: {
    subOrgId: v.string(),
    domain: v.string(),
    slug: v.string(),
  },
  handler: async (_ctx, args): Promise<{
    did: string;
    didDocument: unknown;
    didLog: unknown;
  }> => {
    console.log(
      `[didCreation] Creating list did:webvh for slug: ${args.slug} (subOrg: ${args.subOrgId})`
    );

    const result = await createDIDRecord(args.subOrgId, args.domain, args.slug);

    console.log(`[didCreation] Created list did:webvh: ${result.did}`);
    return result;
  },
});
