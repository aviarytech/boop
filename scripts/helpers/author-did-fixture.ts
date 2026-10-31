// Fixture for the #286 author DID tests.
//
// TURNKEY IS MOCKED: `mockTurnkey` stands in for the author's Turnkey session
// with local Ed25519 keys, one per wallet account, and signs exactly the bytes
// it is given (as Turnkey's signRawPayload with HASH_FUNCTION_NOT_APPLICABLE
// does). Nothing here talks to Turnkey.
import { getPublicKeyAsync, signAsync, utils, verifyAsync } from "@noble/ed25519";
import { createDID, updateDID, deactivateDID, prepareDataForSigning, MultibaseEncoding, multibaseEncode } from "didwebvh-ts";
import type { SigningInput } from "didwebvh-ts";
import * as authorDid from "../../src/lib/authorDid";
import * as originalsSigning from "../../src/lib/originalsSigning";
import * as shared from "../../shared/authorDid";
import * as authorDidLog from "../../convex/lib/authorDidLog";

export { authorDid, originalsSigning, shared, authorDidLog };

export interface MockTurnkey extends authorDid.AuthorKeyBackend {
  calls: Array<{ op: string; path?: string; address?: string }>;
  secretFor(path: string): Uint8Array;
  addAccount(path: string): Promise<void>;
}

/** A sub-org wallet holding the given Ed25519 account paths. */
export async function mockTurnkey(paths: string[] = [shared.AUTHOR_KEY_PATH]): Promise<MockTurnkey> {
  const accounts: authorDid.TurnkeyEd25519Account[] = [];
  const secrets = new Map<string, Uint8Array>();
  const calls: MockTurnkey["calls"] = [];
  const addAccount = async (path: string) => {
    const secret = utils.randomSecretKey();
    const publicKey = await getPublicKeyAsync(secret);
    const address = multibaseEncode(publicKey, MultibaseEncoding.BASE58_BTC).slice(1);
    secrets.set(address, secret);
    accounts.push({ walletId: "wallet-1", address, path, publicKey });
  };
  for (const path of paths) await addAccount(path);
  return {
    calls,
    addAccount,
    secretFor: path => secrets.get(accounts.find(a => a.path === path)!.address)!,
    async ed25519Accounts() {
      calls.push({ op: "accounts" });
      return accounts.map(a => ({ ...a }));
    },
    async createEd25519Account(_subOrgId, _walletId, path) {
      calls.push({ op: "create", path });
      await addAccount(path);
    },
    async sign(_subOrgId, address, message) {
      calls.push({ op: "sign", address });
      return signAsync(message, secrets.get(address)!);
    },
  };
}

/** A did:webvh in the shape boop minted before #286: one local key in every role, controller "". */
export async function mintLegacyDid(domain = "boop.ad", path = "user-legacy") {
  const secret = utils.randomSecretKey();
  const key = multibaseEncode(new Uint8Array([0xed, 0x01, ...(await getPublicKeyAsync(secret))]), MultibaseEncoding.BASE58_BTC);
  const signer = {
    async sign(input: SigningInput) {
      const payload = await prepareDataForSigning(input.document as Record<string, unknown>, input.proof);
      return { proofValue: multibaseEncode(await signAsync(payload, secret), MultibaseEncoding.BASE58_BTC) };
    },
    getVerificationMethodId: () => `did:key:${key}`,
    verify: (signature: Uint8Array, message: Uint8Array, publicKey: Uint8Array) =>
      verifyAsync(signature, message, publicKey.length === 33 ? publicKey.slice(1) : publicKey),
  };
  const result = await createDID({
    domain, signer, verifier: signer, updateKeys: [key], paths: [path], portable: false,
    verificationMethods: [
      { id: "#key-0", type: "Multikey", controller: "", publicKeyMultibase: key },
      { id: "#key-1", type: "Multikey", controller: "", publicKeyMultibase: key },
    ],
    authentication: ["#key-0"], assertionMethod: ["#key-1"],
  });
  return { did: result.did, jsonl: authorDid.serializeDidLog(result.log), secret, key };
}

/** A fresh author DID on `turnkey`, as the client mints it at re-genesis. */
export async function mintAuthor(turnkey: MockTurnkey, options: { domain?: string; path?: string; shareUpdateKey?: boolean } = {}) {
  let keys = await authorDid.resolveAuthorKeys(turnkey, "sub-org");
  // The case Originals 5 must refuse: one key as both update and assertion key.
  if (options.shareUpdateKey) keys = { author: keys.author, assertion: keys.author };
  const minted = options.shareUpdateKey
    ? await mintUnchecked(turnkey, keys, options.domain ?? "boop.ad", options.path ?? "user-author")
    : await authorDid.mintAuthorDid({ backend: turnkey, subOrgId: "sub-org", keys, domain: options.domain ?? "boop.ad", path: options.path ?? "user-author" });
  const listAuthor = authorDid.buildListAuthor({
    backend: turnkey, subOrgId: "sub-org", keys, did: minted.did, versionId: minted.versionId, log: minted.jsonl,
  });
  return { ...minted, keys, listAuthor };
}

/** mintAuthorDid without its own shape check, so a test can build a DID the shape check would refuse. */
async function mintUnchecked(turnkey: MockTurnkey, keys: authorDid.AuthorKeys, domain: string, path: string) {
  const controller = `did:webvh:{SCID}:${domain}:${path}`;
  const signer = authorDid.authorUpdateSigner(turnkey, "sub-org", keys.author);
  const result = await createDID({
    domain, signer, verifier: signer, updateKeys: [keys.author.multikey], paths: [path], portable: false,
    verificationMethods: [
      { id: "#key-0", type: "Multikey", controller, publicKeyMultibase: keys.author.multikey },
      { id: "#orig-1", type: "Multikey", controller, publicKeyMultibase: keys.assertion.multikey },
    ],
    authentication: ["#key-0"], assertionMethod: ["#orig-1"],
  });
  return { did: result.did, log: result.log, jsonl: authorDid.serializeDidLog(result.log), versionId: result.meta.versionId };
}

/** An update to `minted` signed through Turnkey by the author key (adds a service, changes no key). */
export async function updateAuthor(turnkey: MockTurnkey, minted: { jsonl: string; keys: authorDid.AuthorKeys }) {
  const signer = authorDid.authorUpdateSigner(turnkey, "sub-org", minted.keys.author);
  const log = authorDid.parseDidLog(minted.jsonl);
  const result = await updateDID({
    log, signer, verifier: signer,
    services: [{ id: "#files", type: "LinkedDomains", serviceEndpoint: "https://boop.ad/files" }],
  });
  return authorDid.serializeDidLog(result.log);
}

/**
 * The last entry of `jsonl`, re-signed by `secret` (whose Multikey is
 * `multikey`) in place of the key that signed it: a well-formed proof by a key
 * that is not one of the DID's update keys.
 */
export async function resignLastEntry(jsonl: string, from: string, secret: Uint8Array, multikey: string) {
  const log = authorDid.parseDidLog(jsonl);
  const entry = log[log.length - 1] as unknown as Record<string, unknown> & { proof: Array<Record<string, unknown>> };
  const { proof, ...document } = entry;
  const options = { ...proof[0] };
  delete options.proofValue;
  const forged = { ...options, verificationMethod: String(options.verificationMethod).split(from).join(multikey) };
  const payload = await prepareDataForSigning(document, forged as never);
  entry.proof = [{ ...forged, proofValue: multibaseEncode(await signAsync(payload, secret), MultibaseEncoding.BASE58_BTC) }];
  return authorDid.serializeDidLog(log);
}

/** The pinned keys the server derives from the sub-org's Turnkey accounts. */
export const pinned = (keys: authorDid.AuthorKeys) => ({ keys: { authorKey: keys.author.multikey, assertionKey: keys.assertion.multikey } });

/** What authInternal.listSubOrgEd25519Accounts returns for this mock sub-org. */
export async function accountsOf(turnkey: MockTurnkey) {
  return (await turnkey.ed25519Accounts("sub-org")).map(({ path, address }) => ({ path, address }));
}

/** Replace the last entry's proof, keeping it otherwise valid: the shape didwebvh-ts 2.8 accepts without a signature. */
export function withProof(jsonl: string, index: number, proof: unknown) {
  const log = authorDid.parseDidLog(jsonl) as unknown as Array<Record<string, unknown>>;
  log[index] = { ...log[index], proof };
  return log.map(entry => JSON.stringify(entry)).join("\n");
}

/** A deactivating entry signed by the author key. */
export async function deactivateAuthor(turnkey: MockTurnkey, minted: { jsonl: string; keys: authorDid.AuthorKeys }) {
  const signer = authorDid.authorUpdateSigner(turnkey, "sub-org", minted.keys.author);
  const result = await deactivateDID({ log: authorDid.parseDidLog(minted.jsonl), signer, verifier: signer });
  return authorDid.serializeDidLog(result.log);
}

/**
 * The #300 round-2 attack: a genesis under the attacker's own author key,
 * then an update, legitimately signed by it, that hands the DID to the
 * victim's public keys, optionally keeping an extra assertion key of the
 * attacker's. Needs no access to the victim's Turnkey.
 */
export async function handOver(attacker: Awaited<ReturnType<typeof mintAuthor>>, attackerTurnkey: MockTurnkey, victim: authorDid.AuthorKeys, options: { extraKey?: string } = {}) {
  const signer = authorDid.authorUpdateSigner(attackerTurnkey, "sub-org", attacker.keys.author);
  const did = attacker.did;
  const result = await updateDID({
    log: authorDid.parseDidLog(attacker.jsonl), signer, verifier: signer,
    updateKeys: [victim.author.multikey],
    verificationMethods: [
      { id: "#key-0", type: "Multikey", controller: did, publicKeyMultibase: victim.author.multikey },
      { id: "#orig-1", type: "Multikey", controller: did, publicKeyMultibase: victim.assertion.multikey },
      ...(options.extraKey ? [{ id: "#evil", type: "Multikey", controller: did, publicKeyMultibase: options.extraKey }] : []),
    ],
    authentication: ["#key-0"],
    assertionMethod: ["#orig-1", ...(options.extraKey ? ["#evil"] : [])],
  });
  return authorDid.serializeDidLog(result.log);
}
