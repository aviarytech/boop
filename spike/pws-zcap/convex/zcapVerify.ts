// THROWAWAY spike code (#286). Gate 2: verify an HTTP-signature zCap
// invocation and its delegation chain. No "use node": this module is bundled
// into Convex's default V8 runtime (http.ts) and into the Node runtime
// (nodeVerify.ts) unchanged.
import { verifyCapabilityInvocation } from "@interop/http-signature-zcap-verify";
import { extendDocumentLoader } from "@interop/zcap";
import { verifyHeaderValue } from "@interop/http-digest-header";
import { DataIntegrityProof } from "@interop/data-integrity-proof";
import { createVerifyCryptosuite } from "@interop/ed25519-signature/eddsa-jcs-2022";
import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha2.js";
import { base58 } from "@scure/base";

ed.hashes.sha512 ??= sha512;

type Json = Record<string, any>;
const RELATIONSHIPS = ["authentication", "assertionMethod", "capabilityInvocation", "capabilityDelegation", "keyAgreement"];

function didKeyDocument(did: string): Json {
  const mk = did.slice("did:key:".length);
  const vm = `${did}#${mk}`;
  return {
    "@context": ["https://www.w3.org/ns/did/v1", "https://w3id.org/security/multikey/v1"],
    id: did,
    verificationMethod: [{ id: vm, type: "Multikey", controller: did, publicKeyMultibase: mk }],
    authentication: [vm], assertionMethod: [vm], capabilityInvocation: [vm], capabilityDelegation: [vm],
  };
}

function absolutize(document: Json): Json {
  const abs = (ref: unknown) => (typeof ref === "string" && ref.startsWith("#") ? `${document.id}${ref}` : ref);
  const out: Json = { ...document };
  if (out.verificationMethod) out.verificationMethod = out.verificationMethod.map((vm: Json) => ({ ...vm, id: abs(vm.id) }));
  for (const rel of RELATIONSHIPS) if (out[rel]) out[rel] = out[rel].map(abs);
  return out;
}

export type VerifyInput = {
  url: string;
  method: string;
  headers: Record<string, string>;
  /** The request body exactly as received, when there is one. */
  body?: string;
  /** Space root: the URL prefix the user's delegations are rooted at, and who controls it. */
  rootTarget: string;
  rootController: string;
  expectedAction: string;
  /** Resolved DID documents by DID (did:key is derived). In boop this is the didLogs table. */
  didDocuments: Record<string, Json>;
  /** Unix seconds; defaults to the runtime clock. */
  now?: number;
};

export async function verifyInvocation(input: VerifyInput) {
  const rootId = `urn:zcap:root:${encodeURIComponent(input.rootTarget)}`;
  const documentLoader = extendDocumentLoader(async (url: string) => {
    if (url === rootId) {
      return { contextUrl: null, documentUrl: url, document: { "@context": "https://w3id.org/zcap/v1", id: rootId, invocationTarget: input.rootTarget, controller: input.rootController } };
    }
    const [did, fragment] = url.split("#");
    const raw = did.startsWith("did:key:") ? didKeyDocument(did) : input.didDocuments[did];
    if (!raw) throw new Error(`unknown DID ${did}`);
    const document = absolutize(raw);
    if (fragment === undefined) return { contextUrl: null, documentUrl: url, document };
    const method = (document.verificationMethod ?? []).find((vm: Json) => vm.id === url);
    if (!method) throw new Error(`unknown verification method ${url}`);
    return { contextUrl: null, documentUrl: url, document: { "@context": document["@context"], ...method } };
  }) as any;

  const started = Date.now();
  const result = await verifyCapabilityInvocation({
    url: input.url,
    method: input.method,
    headers: input.headers,
    expectedHost: new URL(input.url).host,
    expectedAction: input.expectedAction,
    expectedRootCapability: rootId,
    expectedTarget: input.url,
    allowTargetAttenuation: true,
    maxChainLength: 2, // root -> agent; agents do not re-delegate
    maxDelegationTtl: 31 * 24 * 3600 * 1000, // D12: 30 days
    suite: new DataIntegrityProof({ cryptosuite: createVerifyCryptosuite() }) as any,
    documentLoader,
    ...(input.now !== undefined ? { now: input.now } : {}),
    async getVerifier({ keyId }: { keyId: string }) {
      const { document: verificationMethod } = await documentLoader(keyId);
      const publicKey = base58.decode(verificationMethod.publicKeyMultibase.slice(1)).slice(2);
      return {
        verificationMethod,
        verifier: { id: keyId, algorithm: "Ed25519", verify: async ({ data, signature }: { data: Uint8Array; signature: Uint8Array }) => ed.verify(signature, data, publicKey) },
      };
    },
  } as any);

  // http-signature-zcap-verify only requires the `digest` header to be under
  // the signature when there is a content-type. It never reads the body, so
  // binding the body to the signed digest is the route's job.
  if (result.verified && input.body !== undefined) {
    const digest = Object.entries(input.headers).find(([name]) => name.toLowerCase() === "digest")?.[1];
    const bound = digest !== undefined
      && (await verifyHeaderValue({ data: new TextEncoder().encode(input.body), headerValue: digest }).catch(() => ({ verified: false }))).verified;
    if (!bound) return { verified: false, ms: Date.now() - started, error: "The request body does not match the signed Digest header." };
  }

  const error = (result as any).error;
  const chain: Json[] = (result as any).dereferencedChain ?? [];
  return {
    verified: result.verified === true,
    ms: Date.now() - started,
    ...(result.verified
      ? {
          invoker: (result as any).invoker as string,
          action: (result as any).capabilityAction as string,
          chain: chain.map(zcap => ({ id: zcap.id, controller: zcap.controller, expires: zcap.expires ?? null, delegatedBy: zcap.proof?.verificationMethod ?? null })),
        }
      : { error: String(error?.errors?.[0]?.message ?? error?.message ?? error) }),
  };
}
