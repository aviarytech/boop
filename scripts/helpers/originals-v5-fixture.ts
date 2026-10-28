// Fixture for scripts/originals-v5.test.mjs: real did:webvh authors and an
// in-memory host that judges with the Convex host's own code.
import { getPublicKeyAsync, signAsync, utils, verifyAsync } from "@noble/ed25519";
import { createDID, MultibaseEncoding, multibaseEncode, prepareDataForSigning } from "didwebvh-ts";
import type { SigningInput, SigningOutput } from "didwebvh-ts";
import { getFunctionName } from "convex/server";
import { keySigner } from "@originals/sdk/originals";
import * as originals from "../../src/lib/originals";
import { judgeSubmission, type HostedState } from "../../convex/lib/originalsSubmission";

export { originals, judgeSubmission };

async function multikey(secret: Uint8Array): Promise<string> {
  const publicKey = await getPublicKeyAsync(secret);
  return multibaseEncode(new Uint8Array([0xed, 0x01, ...publicKey]), MultibaseEncoding.BASE58_BTC);
}

/** The DID update signer, as boop's browser signer does it. */
class UpdateKeySigner {
  constructor(private readonly secret: Uint8Array, private readonly publicKeyMultibase: string) {}
  async sign(input: SigningInput): Promise<SigningOutput> {
    const payload = await prepareDataForSigning(input.document as Record<string, unknown>, input.proof);
    return { proofValue: multibaseEncode(await signAsync(payload, this.secret), MultibaseEncoding.BASE58_BTC) };
  }
  async verify(signature: Uint8Array, message: Uint8Array, publicKey: Uint8Array): Promise<boolean> {
    return verifyAsync(signature, message, publicKey.length === 33 ? publicKey.slice(1) : publicKey);
  }
  getVerificationMethodId() {
    return `did:key:${this.publicKeyMultibase}`;
  }
}

let authors = 0;

/**
 * A did:webvh author: an update key controls the DID, and a separate device
 * key in assertionMethod signs Originals. `shareUpdateKey` mints the shape
 * boop mints today, one key in both roles, which Originals 5 refuses.
 */
export async function makeAuthor(options: { shareUpdateKey?: boolean } = {}) {
  const updateSecret = utils.randomSecretKey();
  const deviceSecret = options.shareUpdateKey ? updateSecret : utils.randomSecretKey();
  const updateKey = await multikey(updateSecret);
  const deviceKey = await multikey(deviceSecret);
  const signer = new UpdateKeySigner(updateSecret, updateKey);
  const path = `user-${++authors}`;
  // Originals 5 requires each key's controller to be the DID (P5.3); the
  // genesis {SCID} placeholder is replaced with the real SCID on creation.
  const controller = `did:webvh:{SCID}:boop.test:${path}`;
  const result = await createDID({
    domain: "boop.test",
    signer,
    verifier: signer,
    updateKeys: [updateKey],
    verificationMethods: [
      { id: "#key-0", type: "Multikey", controller, publicKeyMultibase: updateKey },
      { id: "#device-1", type: "Multikey", controller, publicKeyMultibase: deviceKey },
    ],
    paths: [path],
    portable: false,
    authentication: ["#key-0"],
    assertionMethod: ["#device-1"],
  });
  const did = result.did;
  const log = result.log.map((entry) => JSON.stringify(entry)).join("\n");
  const verificationMethod = `${did}#device-1`;
  const listAuthor: originals.ListAuthor = {
    author: { did, verificationMethod, versionId: result.log.at(-1)!.versionId },
    signer: keySigner({ keyType: "Ed25519", secretKey: deviceSecret, verificationMethod }),
    evidence: { did, log, source: "supplied", obtainedAt: new Date().toISOString() },
  };
  return { did, log, listAuthor };
}

let lists = 0;

/** One list on an in-memory host that judges with judgeSubmission and commits by compare-and-swap, as the Convex mutation does. */
export function makeHost(options: { ownerDid: string; authorLog: string; judgeSubmission: typeof judgeSubmission }) {
  const listId = `list-${++lists}` as never;
  let original: HostedState["original"] = null;
  let assetDid: string | undefined;
  const resources = new Map<string, Uint8Array>();
  let hook: (() => Promise<unknown>) | null = null;

  const state = (): HostedState => ({ ownerDid: options.ownerDid, original, authorLog: options.authorLog });

  const client = {
    async query(ref: never) {
      if (getFunctionName(ref) !== "originalsHost:getAccepted") throw new Error(`unexpected query ${getFunctionName(ref)}`);
      if (!original) return null;
      return {
        did: original.did, log: original.log, head: original.head,
        author: { did: options.ownerDid, log: options.authorLog },
        resources: [...resources].map(([digest, bytes]) => ({ digest, bytes: bytes.slice().buffer })),
      };
    },
    async action(ref: never, args: { original: string; entry: string; resources: Array<{ digest: string; bytes: ArrayBuffer }> }) {
      if (getFunctionName(ref) !== "originalsHost:submitEntry") throw new Error(`unexpected action ${getFunctionName(ref)}`);
      if (hook) {
        const run = hook;
        hook = null;
        await run();
      }
      const judged = await options.judgeSubmission(state(), args, Date.now());
      if ("answer" in judged) return judged.answer;
      const { log, head, expectedHead } = judged.commit;
      if ((original?.head ?? null) !== expectedHead) return { status: "stale-parent", head: original!.head };
      for (const r of args.resources) resources.set(r.digest, new Uint8Array(r.bytes));
      if (!original) assetDid = args.original;
      original = { did: args.original, log, head };
      return { status: "accepted", checkpoint: head, head };
    },
  } as unknown as originals.OriginalsClient;

  return {
    listId,
    client,
    state,
    assetDid: () => assetDid,
    logLines: () => (original?.log ?? "").split("\n").filter(Boolean),
    beforeNextSubmit(run: () => Promise<unknown>) {
      hook = run;
    },
    tamperResources() {
      for (const [digest, bytes] of resources) {
        const changed = bytes.slice();
        changed[0] ^= 0xff;
        resources.set(digest, changed);
      }
    },
  };
}
