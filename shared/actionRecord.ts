/** Signed action records (#237): payload contract, canonical bytes, the
 * client-side signing envelope, and an independent verifier. Pure (no Convex
 * ctx, no network) so the server, the browser and outside verifiers share one
 * definition. See docs/action-records.md.
 *
 * Version 2 is what the author signs: the action, its subject, the resulting
 * state, the author DID with the exact verification method and DID version the
 * signature is to be checked against, and the author's clock. Everything the
 * server knows and the author does not (server time, the prior state, the
 * credential row, server-assigned ids) is stored beside it as unsigned,
 * server-attested metadata. Version 1 records were never signed; they are kept
 * readable here and nowhere else.
 */
import { sha256, sha512 } from "@noble/hashes/sha2.js";
import { bytesToHex, concatBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import * as ed25519 from "@noble/ed25519";

// Pure-JS SHA-512, so verification works in every runtime that bundles this
// (Convex mutations included) without relying on crypto.subtle.
ed25519.hashes.sha512 ??= sha512;

export const ACTION_RECORD_SCHEMA = "boop.action-record";
export const ACTION_RECORD_VERSION = 2;
/** The author's assertion key in their did:webvh (shared/authorDid.ts ASSERTION_VM_FRAGMENT). */
export const ACTION_SIGNING_KEY_FRAGMENT = "orig-1";
// Domain-separates action signatures from anything else the same key signs.
const signingDomain = (version: number) => `${ACTION_RECORD_SCHEMA}/v${version}`;

/** Row identity of the authenticated session or API key; never a token or hash. */
export type ActionCredential = { kind: "session" | "apiKey"; id: string };

/**
 * What happened, and to what, in the words the author can sign. The subject
 * names only identifiers the author knows when acting: an existing item or
 * list by its id, and a new list by the creation time the author chose (its
 * Original is minted later, on the owner's device). The server's id for a new
 * item or list is attested, not signed.
 */
export type ActionChange =
  | { action: "item.created"; subject: { listId: string }; after: { name: string } }
  | { action: "item.completed"; subject: { itemId: string }; after: { checked: true } }
  | { action: "item.reopened"; subject: { itemId: string }; after: { checked: false } }
  | { action: "list.created"; subject: { createdAt: number }; after: { name: string; kind: "list" | "note" } }
  | { action: "list.renamed"; subject: { listId: string }; after: { name: string } };

export type ActionType = ActionChange["action"];
const ACTION_TYPES: readonly string[] = [
  "item.created", "item.completed", "item.reopened", "list.created", "list.renamed",
] satisfies ActionType[];

/** The signer: the author DID at the version whose `verificationMethod` is to be checked. */
export type ActionAuthor = { did: string; verificationMethod: string; versionId: string };

export type ActionRecordPayload = ActionChange & {
  schema: typeof ACTION_RECORD_SCHEMA;
  version: typeof ACTION_RECORD_VERSION;
  /** The account that authorized the action. Key and version are present only when it signed. */
  author: { did: string; verificationMethod?: string; versionId?: string };
  /** The author's clock when signing, ms since epoch. Absent on unsigned records. */
  signedAt?: number;
};

/** Server-known context stored beside the payload, unsigned (`attested` column). */
export type ActionRecordAttested = {
  /** Server clock of the mutation, ms since epoch. */
  occurredAt: number;
  /** users row of the authorizing account. */
  userId: string;
  credential: ActionCredential;
  listId: string;
  itemId?: string;
  listAssetDid?: string;
  before?: { checked: boolean } | { name: string } | null;
  /** item.completed: the checkedAt stored on the item, when it was a finite number. */
  checkedAt?: number;
  origin?:
    | { kind: "recurrence"; sourceItemId: string }
    | { kind: "template"; source: string }
    | { kind: "copy"; sourceListId: string };
};

export type ActionRecordStatus = "pending" | "signed" | "failed" | "unsigned";

/** Wire shape of a stored record. `payload` is the exact UTF-8 text that was signed. */
export type ActionRecordEvidence = {
  payload: string;
  /** Lowercase hex SHA-256 of `payload`. */
  digest: string;
  status: ActionRecordStatus;
  /** Multibase base58btc Ed25519 signature over `actionRecordSigningInput(payload)`. */
  signature?: string;
  /** The author's verification method, `did:webvh:…#orig-1`; equals payload.author.verificationMethod. */
  verificationMethod?: string;
  publicKeyMultibase?: string;
  signedAt?: number;
  /** Canonical JSON of ActionRecordAttested. Unsigned. */
  attested?: string;
  error?: string;
  // Unsigned index columns; the verifier requires them to agree with the payload where it names them.
  listId?: string;
  itemId?: string;
  ownerUserId?: string;
};

/** What a client sends with a mutation: one signature per signed subject. */
export type ActionSignatureEnvelope = {
  verificationMethod: string;
  versionId: string;
  signedAt: number;
  signatures: Array<{ subject: string; signature: string }>;
};

/** Deterministic JSON per RFC 8785: sorted keys, no whitespace, ECMAScript number and string forms. */
export function canonicalize(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Action payload numbers must be finite");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return `{${Object.keys(value).sort().map(key =>
      `${JSON.stringify(key)}:${canonicalize((value as Record<string, unknown>)[key])}`).join(",")}}`;
  }
  throw new Error(`Action payload cannot contain ${typeof value}`);
}

export function actionRecordDigest(payload: string): string {
  return bytesToHex(sha256(utf8ToBytes(payload)));
}

/** The 64 bytes actually signed: SHA-256(domain) || SHA-256(payload). */
export function actionRecordSigningInput(payload: string, version: number = ACTION_RECORD_VERSION): Uint8Array {
  return concatBytes(sha256(utf8ToBytes(signingDomain(version))), sha256(utf8ToBytes(payload)));
}

/** The key a signature in an envelope is filed under: the change's canonical subject. */
export function actionSubjectKey(change: Pick<ActionChange, "subject">): string {
  return canonicalize(change.subject);
}

/**
 * The exact bytes for one action. The client and the server call this with
 * the same change and author, and must get the same string: the server only
 * stores a signature over bytes it rebuilt itself.
 */
export function buildActionRecord(change: ActionChange, author: ActionRecordPayload["author"], signedAt?: number): { payload: string; digest: string } {
  const body: ActionRecordPayload = {
    action: change.action,
    subject: change.subject,
    after: change.after,
    schema: ACTION_RECORD_SCHEMA,
    version: ACTION_RECORD_VERSION,
    author: {
      did: author.did,
      ...(author.verificationMethod !== undefined ? { verificationMethod: author.verificationMethod } : {}),
      ...(author.versionId !== undefined ? { versionId: author.versionId } : {}),
    },
    ...(signedAt !== undefined ? { signedAt } : {}),
  } as ActionRecordPayload;
  const payload = canonicalize(body);
  return { payload, digest: actionRecordDigest(payload) };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Structural check of a version-2 payload. */
export function parseActionRecordPayload(payload: string): ActionRecordPayload | null {
  let parsed: unknown;
  try { parsed = JSON.parse(payload); } catch { return null; }
  if (!isRecord(parsed) || parsed.schema !== ACTION_RECORD_SCHEMA || parsed.version !== ACTION_RECORD_VERSION) return null;
  const { action, subject, author, after, signedAt } = parsed;
  if (typeof action !== "string" || !ACTION_TYPES.includes(action)) return null;
  if (!isRecord(subject) || !isRecord(after)) return null;
  if (Object.keys(subject).length !== 1) return null;
  if (action === "list.created" ? typeof subject.createdAt !== "number"
    : typeof subject[action === "item.created" || action === "list.renamed" ? "listId" : "itemId"] !== "string") return null;
  if (!isRecord(author) || typeof author.did !== "string") return null;
  if (author.verificationMethod !== undefined && typeof author.verificationMethod !== "string") return null;
  if (author.versionId !== undefined && typeof author.versionId !== "string") return null;
  if (signedAt !== undefined && typeof signedAt !== "number") return null;
  return parsed as ActionRecordPayload;
}

/** The version-1 shape (never signed), kept readable for records written before version 2. */
type LegacyPayload = {
  version: 1;
  action: ActionType;
  subject: { listId: string; listAssetDid?: string; itemId?: string };
  before: unknown;
  after: Record<string, unknown>;
  origin?: ActionRecordAttested["origin"];
  occurredAt: number;
  owner: { did: string; userId: string };
  credential: ActionCredential;
};

function parseLegacyPayload(payload: string): LegacyPayload | null {
  let parsed: unknown;
  try { parsed = JSON.parse(payload); } catch { return null; }
  if (!isRecord(parsed) || parsed.schema !== ACTION_RECORD_SCHEMA || parsed.version !== 1) return null;
  const { action, subject, owner, credential, occurredAt, after } = parsed;
  if (typeof action !== "string" || !ACTION_TYPES.includes(action)) return null;
  if (!isRecord(subject) || typeof subject.listId !== "string" || !isRecord(after)) return null;
  if (!isRecord(owner) || typeof owner.did !== "string" || typeof owner.userId !== "string") return null;
  if (!isRecord(credential) || typeof credential.id !== "string"
    || (credential.kind !== "session" && credential.kind !== "apiKey")) return null;
  if (typeof occurredAt !== "number") return null;
  return parsed as LegacyPayload;
}

export function parseActionRecordAttested(attested: string | undefined): ActionRecordAttested | null {
  if (attested === undefined) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(attested); } catch { return null; }
  if (!isRecord(parsed) || typeof parsed.occurredAt !== "number" || typeof parsed.userId !== "string"
    || typeof parsed.listId !== "string" || !isRecord(parsed.credential)) return null;
  return parsed as ActionRecordAttested;
}

/** One view over both payload versions and the attested metadata, for presentation. */
export type ActionRecordDescription = {
  version: 1 | 2;
  action: ActionType;
  /** The account that authorized the action (payload, signed in version 2). */
  ownerDid: string;
  after: Record<string, unknown>;
  /** Signed subject identifiers. */
  subject: Record<string, string | number>;
  /** Signer binding, present only on signed version-2 payloads. */
  author?: ActionAuthor;
  signedAt?: number;
  // Server-attested, unsigned.
  credential?: ActionCredential;
  occurredAt?: number;
  before?: unknown;
  origin?: ActionRecordAttested["origin"];
  listAssetDid?: string;
};

export function describeActionRecord(record: Pick<ActionRecordEvidence, "payload" | "attested">): ActionRecordDescription | null {
  const payload = parseActionRecordPayload(record.payload);
  if (payload) {
    const attested = parseActionRecordAttested(record.attested);
    const author = payload.author.verificationMethod !== undefined && payload.author.versionId !== undefined
      ? { did: payload.author.did, verificationMethod: payload.author.verificationMethod, versionId: payload.author.versionId } : undefined;
    return {
      version: 2, action: payload.action, ownerDid: payload.author.did, after: payload.after, subject: payload.subject,
      ...(author ? { author } : {}), ...(payload.signedAt !== undefined ? { signedAt: payload.signedAt } : {}),
      ...(attested ? {
        credential: attested.credential, occurredAt: attested.occurredAt, before: attested.before,
        ...(attested.origin ? { origin: attested.origin } : {}),
        ...(attested.listAssetDid !== undefined ? { listAssetDid: attested.listAssetDid } : {}),
      } : {}),
    };
  }
  const legacy = parseLegacyPayload(record.payload);
  if (!legacy) return null;
  const { listAssetDid, ...subject } = legacy.subject;
  return {
    version: 1, action: legacy.action, ownerDid: legacy.owner.did, after: legacy.after,
    subject: Object.fromEntries(Object.entries(subject).filter(([, v]) => typeof v === "string")) as Record<string, string>,
    credential: legacy.credential, occurredAt: legacy.occurredAt, before: legacy.before,
    ...(legacy.origin ? { origin: legacy.origin } : {}), ...(listAssetDid !== undefined ? { listAssetDid } : {}),
  };
}

/**
 * The changes a client-originated mutation records, built from the arguments
 * the client sends, so the client can sign exactly what the server will write.
 * convex/lib/actionRecords.ts builds the server side; the two must agree, and
 * scripts/signed-action-records.test.mjs checks that they do end to end.
 * Server-originated records (recurrence, templates, copies) are not here.
 */
export function clientActionChanges(mutation: string, args: Record<string, unknown>): ActionChange[] {
  const str = (key: string) => (typeof args[key] === "string" ? (args[key] as string) : null);
  const num = (key: string) => (typeof args[key] === "number" && Number.isFinite(args[key]) ? (args[key] as number) : null);
  switch (mutation) {
    case "addItem": {
      const listId = str("listId"), name = str("name");
      return listId !== null && name !== null ? [{ action: "item.created", subject: { listId }, after: { name } }] : [];
    }
    case "checkItem": {
      const itemId = str("itemId");
      return itemId !== null ? [{ action: "item.completed", subject: { itemId }, after: { checked: true } }] : [];
    }
    case "uncheckItem": {
      const itemId = str("itemId");
      return itemId !== null ? [{ action: "item.reopened", subject: { itemId }, after: { checked: false } }] : [];
    }
    case "batchCheckItems":
    case "batchUncheckItems": {
      const ids = Array.isArray(args.itemIds) ? [...new Set(args.itemIds.filter((id): id is string => typeof id === "string"))] : [];
      return ids.map(itemId => mutation === "batchCheckItems"
        ? { action: "item.completed", subject: { itemId }, after: { checked: true } }
        : { action: "item.reopened", subject: { itemId }, after: { checked: false } });
    }
    case "createList": {
      const createdAt = num("createdAt"), name = str("name");
      return createdAt !== null && name !== null
        ? [{ action: "list.created", subject: { createdAt }, after: { name, kind: args.kind === "note" ? "note" : "list" } }] : [];
    }
    case "renameList": {
      const listId = str("listId"), name = str("name");
      return listId !== null && name !== null ? [{ action: "list.renamed", subject: { listId }, after: { name } }] : [];
    }
    default:
      return [];
  }
}

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function base58Encode(bytes: Uint8Array): string {
  const digits: number[] = [];
  for (const byte of bytes) {
    let carry = byte;
    for (let i = 0; i < digits.length; i++) {
      carry += digits[i] << 8;
      digits[i] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    for (; carry > 0; carry = Math.floor(carry / 58)) digits.push(carry % 58);
  }
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
  return "1".repeat(zeros) + digits.reverse().map(digit => BASE58[digit]).join("");
}

export function base58Decode(text: string): Uint8Array | null {
  const bytes: number[] = [];
  for (const char of text) {
    let carry = BASE58.indexOf(char);
    if (carry < 0) return null;
    for (let i = 0; i < bytes.length; i++) {
      carry += bytes[i] * 58;
      bytes[i] = carry & 0xff;
      carry >>= 8;
    }
    for (; carry > 0; carry >>= 8) bytes.push(carry & 0xff);
  }
  let zeros = 0;
  while (zeros < text.length && text[zeros] === "1") zeros++;
  return Uint8Array.from([...new Array<number>(zeros).fill(0), ...bytes.reverse()]);
}

const ED25519_MULTICODEC = [0xed, 0x01];

/** Standard Multikey form (`z6Mk…`) of a raw Ed25519 public key. */
export function ed25519Multikey(publicKey: Uint8Array): string {
  return `z${base58Encode(Uint8Array.from([...ED25519_MULTICODEC, ...publicKey]))}`;
}

/** Accepts raw bytes, a Multikey, a bare base58 key (Turnkey/Solana address), or either as did:key. */
export function parseEd25519PublicKey(key: string | Uint8Array): Uint8Array | null {
  if (typeof key !== "string") return key.length === 32 ? key : null;
  const text = key.replace(/^did:key:/, "").split("#")[0];
  if (text.startsWith("z")) {
    const multikey = base58Decode(text.slice(1));
    if (multikey?.length === 34 && multikey[0] === ED25519_MULTICODEC[0] && multikey[1] === ED25519_MULTICODEC[1]) {
      return multikey.slice(2);
    }
  }
  const raw = base58Decode(text);
  return raw?.length === 32 ? raw : null;
}

export function encodeSignature(signature: Uint8Array): string {
  return `z${base58Encode(signature)}`;
}

export function decodeSignature(signature: string): Uint8Array | null {
  const bytes = signature.startsWith("z") ? base58Decode(signature.slice(1)) : null;
  return bytes?.length === 64 ? bytes : null;
}

/** Synchronous, so it runs inside a Convex mutation as well as in a browser. */
export function verifyActionSignature(payload: string, signature: Uint8Array, publicKey: Uint8Array): boolean {
  try {
    return ed25519.verify(signature, actionRecordSigningInput(payload), publicKey);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Keys from an author did:webvh log

type DidLogEntryLike = {
  versionId?: unknown;
  state?: {
    id?: unknown;
    verificationMethod?: Array<{ id?: unknown; type?: unknown; publicKeyMultibase?: unknown }>;
    assertionMethod?: unknown[];
  };
};

/** A did.jsonl as text, or its parsed entries. */
export type DidLogInput = string | readonly unknown[];

function didLogEntries(log: DidLogInput): DidLogEntryLike[] | null {
  if (typeof log !== "string") return log as DidLogEntryLike[];
  try {
    return log.split("\n").filter(line => line.trim().length > 0).map(line => JSON.parse(line) as DidLogEntryLike);
  } catch {
    return null;
  }
}

export type AssertionKeyFailure = "unknown_did_version" | "not_assertion_key";

/**
 * The Multikey of `verificationMethod` as an assertionMethod of `did` at the
 * version of its log named by `versionId`. Takes the log as given: the caller
 * is responsible for having resolved and validated it (didwebvh-ts does both;
 * convex/lib/authorDidLog.ts and src/lib/authorDid.ts wrap it for boop).
 */
export function assertionKeyAt(log: DidLogInput, author: ActionAuthor): { publicKeyMultibase: string } | { failure: AssertionKeyFailure } {
  const entries = didLogEntries(log);
  const entry = entries?.find(candidate => candidate.versionId === author.versionId);
  if (!entry || entry.state?.id !== author.did) return { failure: "unknown_did_version" };
  const absolute = (ref: unknown) => (typeof ref === "string" ? (ref.startsWith("#") ? `${author.did}${ref}` : ref) : "");
  const method = (entry.state.verificationMethod ?? []).find(vm => absolute(vm.id) === author.verificationMethod);
  const asserts = (entry.state.assertionMethod ?? []).some(ref => absolute(ref) === author.verificationMethod);
  if (!method || !asserts || method.type !== "Multikey" || typeof method.publicKeyMultibase !== "string"
    || parseEd25519PublicKey(method.publicKeyMultibase) === null) return { failure: "not_assertion_key" };
  return { publicKeyMultibase: method.publicKeyMultibase };
}

// ---------------------------------------------------------------------------
// Verifier

type TrustedKey = string | Uint8Array;
type MaybePromise<T> = T | Promise<T>;

export type VerifyActionRecordOptions = {
  /**
   * The author's did:webvh log, resolved and validated by the caller. The
   * signing key is taken from the version the payload names.
   */
  resolveDidLog?: (did: string) => MaybePromise<DidLogInput | null | undefined>;
  /** Keys the caller pins by author DID instead of (or as well as) resolving the DID. */
  trustedKeys?: Readonly<Record<string, readonly TrustedKey[]>>;
  resolvePublicKey?: (ownerDid: string, verificationMethod?: string) =>
    MaybePromise<TrustedKey | readonly TrustedKey[] | null | undefined>;
  /** Attribution the caller was shown; the signed payload must agree with it. */
  expected?: { ownerDid?: string };
};

export type VerifyFailure =
  | "not_signed"
  | "malformed_payload"
  | "unsupported_version"
  | "non_canonical_payload"
  | "digest_mismatch"
  | "binding_mismatch"
  | "no_trusted_key"
  | "untrusted_key"
  | "bad_signature"
  | AssertionKeyFailure;

export type VerifyActionRecordResult =
  | { verified: true; payload: ActionRecordPayload; author: ActionAuthor; publicKeyMultibase: string }
  | { verified: false; reason: VerifyFailure };

const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((byte, i) => byte === b[i]);

/**
 * Checks one record. The signing key comes from the author's DID log at the
 * version the payload names, or from keys the caller pins; the key carried by
 * the record itself is never trusted, it only has to agree.
 */
export async function verifyActionRecord(
  record: ActionRecordEvidence,
  options: VerifyActionRecordOptions,
): Promise<VerifyActionRecordResult> {
  const fail = (reason: VerifyFailure): VerifyActionRecordResult => ({ verified: false, reason });

  const signature = record.status === "signed" && record.signature ? decodeSignature(record.signature) : null;
  if (!signature) return fail("not_signed");

  let parsed: unknown;
  try { parsed = JSON.parse(record.payload); } catch { return fail("malformed_payload"); }
  if (isRecord(parsed) && parsed.schema === ACTION_RECORD_SCHEMA && parsed.version !== ACTION_RECORD_VERSION) return fail("unsupported_version");
  const payload = parseActionRecordPayload(record.payload);
  if (!payload) return fail("malformed_payload");
  if (canonicalize(parsed) !== record.payload) return fail("non_canonical_payload");
  if (actionRecordDigest(record.payload) !== record.digest) return fail("digest_mismatch");

  // A signed payload must say which key and DID version it is to be checked against.
  const { did, verificationMethod, versionId } = payload.author;
  if (verificationMethod === undefined || versionId === undefined || payload.signedAt === undefined
    || !verificationMethod.startsWith(`${did}#`) || verificationMethod.length <= did.length + 1) return fail("malformed_payload");
  const author: ActionAuthor = { did, verificationMethod, versionId };

  const subject = payload.subject as Record<string, string | number>;
  if ((record.listId !== undefined && subject.listId !== undefined && record.listId !== subject.listId)
    || (record.itemId !== undefined && subject.itemId !== undefined && record.itemId !== subject.itemId)
    || (record.verificationMethod !== undefined && record.verificationMethod !== verificationMethod)) return fail("binding_mismatch");
  if (options.expected?.ownerDid !== undefined && options.expected.ownerDid !== did) return fail("binding_mismatch");
  const declared = record.publicKeyMultibase === undefined ? undefined : parseEd25519PublicKey(record.publicKeyMultibase);
  if (declared === null) return fail("binding_mismatch");

  const trusted: Uint8Array[] = [];
  const log = await options.resolveDidLog?.(did);
  if (log != null) {
    const key = assertionKeyAt(log, author);
    if ("failure" in key) return fail(key.failure);
    trusted.push(parseEd25519PublicKey(key.publicKeyMultibase)!);
  }
  const resolved = await options.resolvePublicKey?.(did, verificationMethod);
  for (const key of [
    ...(options.trustedKeys?.[did] ?? []),
    ...(resolved == null ? [] : typeof resolved === "string" || resolved instanceof Uint8Array ? [resolved] : resolved),
  ]) {
    const bytes = parseEd25519PublicKey(key);
    if (bytes) trusted.push(bytes);
  }
  if (trusted.length === 0) return fail("no_trusted_key");

  const candidates = declared ? trusted.filter(key => sameBytes(key, declared)) : trusted;
  if (candidates.length === 0) return fail("untrusted_key");
  for (const key of candidates) {
    if (verifyActionSignature(record.payload, signature, key)) {
      return { verified: true, payload, author, publicKeyMultibase: ed25519Multikey(key) };
    }
  }
  return fail("bad_signature");
}
