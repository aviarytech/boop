/**
 * The author's did:webvh, minted and used only through the author's own
 * Turnkey session (#286 PR b). See shared/authorDid.ts for the shape.
 *
 * Turnkey is behind `AuthorKeyBackend` so this module has no session logic of
 * its own; lib/turnkeySession.ts supplies the real one. Every signature
 * Turnkey returns is checked against the expected public key before use.
 */
import {
  createDID,
  MultibaseEncoding,
  multibaseDecode,
  multibaseEncode,
  prepareDataForSigning,
  resolveDIDFromLog,
} from "didwebvh-ts";
import type { DIDLog, SigningInput, SigningOutput } from "didwebvh-ts";
import { verifyAsync } from "@noble/ed25519";
import {
  ASSERTION_KEY_PATH,
  ASSERTION_VM_FRAGMENT,
  AUTHOR_KEY_PATH,
  AUTHOR_VM_FRAGMENT,
  authorDidProblems,
  authorLogProblems,
} from "../../shared/authorDid";
import { parseCanonicalDidLog, requireSignedByUpdateKeys } from "../../shared/didLogSignatures";
import { remoteKeySigner, type EntrySummary, type ListAuthor } from "./originalsSigning";

export interface TurnkeyEd25519Account {
  walletId: string;
  address: string;
  path: string;
  /** Raw 32-byte Ed25519 public key. */
  publicKey: Uint8Array;
}

/** What this module needs from a live Turnkey session in the author's sub-org. */
export interface AuthorKeyBackend {
  ed25519Accounts(subOrgId: string): Promise<TurnkeyEd25519Account[]>;
  createEd25519Account(subOrgId: string, walletId: string, path: string): Promise<void>;
  /** Ed25519 signature (R || S) over exactly `message`, no hashing (HASH_FUNCTION_NOT_APPLICABLE). */
  sign(subOrgId: string, address: string, message: Uint8Array): Promise<Uint8Array>;
}

export interface AuthorKey extends TurnkeyEd25519Account {
  /** `z6Mk…` Ed25519 Multikey. */
  multikey: string;
}

export interface AuthorKeys {
  author: AuthorKey;
  assertion: AuthorKey;
}

export class AuthorDidError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthorDidError";
  }
}

export function ed25519Multikey(publicKey: Uint8Array): string {
  return multibaseEncode(new Uint8Array([0xed, 0x01, ...publicKey]), MultibaseEncoding.BASE58_BTC);
}

/** Turnkey's Solana-format address is the base58 public key; decode it when `publicKey` is absent. */
export function publicKeyFromAddress(address: string): Uint8Array {
  return multibaseDecode(`z${address}`).bytes;
}

const withMultikey = (account: TurnkeyEd25519Account): AuthorKey => ({ ...account, multikey: ed25519Multikey(account.publicKey) });

/**
 * The author key and the assertion key. Sub-orgs created by boop already hold
 * an Ed25519 account at the assertion path; one that doesn't gets it created
 * here, through the author's session, in the author key's wallet.
 */
export async function resolveAuthorKeys(backend: AuthorKeyBackend, subOrgId: string): Promise<AuthorKeys> {
  const find = async (path: string) => (await backend.ed25519Accounts(subOrgId)).find(a => a.path === path);
  const author = await find(AUTHOR_KEY_PATH);
  if (!author) throw new AuthorDidError(`No Ed25519 author account at ${AUTHOR_KEY_PATH}`);
  let assertion = await find(ASSERTION_KEY_PATH);
  if (!assertion) {
    await backend.createEd25519Account(subOrgId, author.walletId, ASSERTION_KEY_PATH);
    assertion = await find(ASSERTION_KEY_PATH);
    if (!assertion) throw new AuthorDidError("Turnkey did not create the assertion account");
  }
  const keys = { author: withMultikey(author), assertion: withMultikey(assertion) };
  if (keys.author.multikey === keys.assertion.multikey) throw new AuthorDidError("The author and assertion keys must differ");
  return keys;
}

/** Sign through Turnkey and refuse a signature that isn't this key's over these bytes. */
async function signChecked(backend: AuthorKeyBackend, subOrgId: string, key: AuthorKey, message: Uint8Array): Promise<Uint8Array> {
  const signature = await backend.sign(subOrgId, key.address, message);
  if (signature.length !== 64 || !(await verifyAsync(signature, message, key.publicKey))) {
    throw new AuthorDidError(`Turnkey returned a signature that does not verify for ${key.path}`);
  }
  return signature;
}

const ed25519Verifier = {
  verify: (signature: Uint8Array, message: Uint8Array, publicKey: Uint8Array) =>
    verifyAsync(signature, message, publicKey.length === 33 ? publicKey.slice(1) : publicKey),
};

/** didwebvh-ts signer for DID updates, backed by the Turnkey author key. */
export function authorUpdateSigner(backend: AuthorKeyBackend, subOrgId: string, key: AuthorKey) {
  return {
    async sign(input: SigningInput): Promise<SigningOutput> {
      const payload = await prepareDataForSigning(input.document as Record<string, unknown>, input.proof);
      const signature = await signChecked(backend, subOrgId, key, payload);
      return { proofValue: multibaseEncode(signature, MultibaseEncoding.BASE58_BTC) };
    },
    // Bare multibase in updateKeys; the proof names did:key (see siteActions.ts).
    getVerificationMethodId: () => `did:key:${key.multikey}`,
    ...ed25519Verifier,
  };
}

export const serializeDidLog = (log: DIDLog) => log.map(entry => JSON.stringify(entry)).join("\n");
export const parseDidLog = (jsonl: string): DIDLog => jsonl.split("\n").filter(line => line.trim()).map(line => JSON.parse(line));

/** Genesis of a new author DID: updateKeys = [author key], assertionMethod = [assertion key]. */
export async function mintAuthorDid(params: {
  backend: AuthorKeyBackend;
  subOrgId: string;
  keys: AuthorKeys;
  domain: string;
  path: string;
}): Promise<{ did: string; log: DIDLog; jsonl: string; versionId: string }> {
  const { keys, domain, path } = params;
  // didwebvh-ts replaces {SCID} throughout the genesis entry, so the
  // controller becomes the DID itself. The domain is percent-encoded in the
  // DID (a dev host carries a port), so encode it here the same way.
  const controller = `did:webvh:{SCID}:${encodeURIComponent(domain)}:${path}`;
  const signer = authorUpdateSigner(params.backend, params.subOrgId, keys.author);
  const result = await createDID({
    domain,
    signer,
    verifier: signer,
    updateKeys: [keys.author.multikey],
    verificationMethods: [
      { id: `#${AUTHOR_VM_FRAGMENT}`, type: "Multikey", controller, publicKeyMultibase: keys.author.multikey },
      { id: `#${ASSERTION_VM_FRAGMENT}`, type: "Multikey", controller, publicKeyMultibase: keys.assertion.multikey },
    ],
    paths: [path],
    portable: false,
    authentication: [`#${AUTHOR_VM_FRAGMENT}`],
    assertionMethod: [`#${ASSERTION_VM_FRAGMENT}`],
  });
  const problems = authorDidProblems(result.doc, result.meta.updateKeys, { authorKey: keys.author.multikey, assertionKey: keys.assertion.multikey });
  if (problems.length > 0) throw new AuthorDidError(`Minted DID is not an author DID: ${problems.join("; ")}`);
  return { did: result.did, log: result.log, jsonl: serializeDidLog(result.log), versionId: result.meta.versionId };
}

/** Resolve a stored log and report whether every version of it is this account's author DID. */
export async function inspectAuthorDid(jsonl: string, keys?: AuthorKeys): Promise<{
  did: string;
  versionId: string;
  problems: string[];
}> {
  // Canonical bytes, as the server requires: anything else may verify here
  // and fail in Originals 5 (#300 review).
  let log: DIDLog;
  try { log = parseCanonicalDidLog(jsonl); }
  catch (error) { return { did: "", versionId: "", problems: [(error as Error).message] }; }
  // The same parameter and signature checks the server makes, before
  // resolving: didwebvh-ts accepts `proof: []`, and acts on witness rules.
  const unsigned = await requireSignedByUpdateKeys(log).then(() => null, (error: Error) => error.message);
  if (unsigned) return { did: String((log.at(-1) as { state?: { id?: unknown } } | undefined)?.state?.id ?? ""), versionId: "", problems: [unsigned] };
  const resolved = await resolveDIDFromLog(log, { verifier: ed25519Verifier });
  const expect = keys ? { authorKey: keys.author.multikey, assertionKey: keys.assertion.multikey } : {};
  const problems = authorLogProblems(log as never, expect);
  // didwebvh-ts accepts a log whose last entries don't verify by stopping short; that isn't this DID's head.
  if (resolved.meta.versionId !== log[log.length - 1]?.versionId) problems.push("the log does not verify to its last entry");
  return { did: resolved.did, versionId: resolved.meta.versionId, problems };
}

/**
 * This account's `ListAuthor` for Originals 5 (PR e's setListAuthorSource):
 * the `#orig-1` assertion key at the DID's current version, signing through
 * Turnkey exactly the bytes keySigner would sign.
 */
export function buildListAuthor(params: {
  backend: AuthorKeyBackend;
  subOrgId: string;
  keys: AuthorKeys;
  did: string;
  versionId: string;
  log: string;
  confirm?: (display: string, summary: EntrySummary) => boolean | Promise<boolean>;
}): ListAuthor {
  const verificationMethod = `${params.did}#${ASSERTION_VM_FRAGMENT}`;
  return {
    author: { did: params.did, verificationMethod, versionId: params.versionId },
    signer: remoteKeySigner({
      verificationMethod,
      signBytes: message => signChecked(params.backend, params.subOrgId, params.keys.assertion, message),
      confirm: params.confirm,
    }),
    evidence: { did: params.did, log: params.log, source: "supplied", obtainedAt: new Date().toISOString() },
  };
}
