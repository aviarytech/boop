/** Signed action records: payload contract, canonical bytes, and an independent
 * verifier. Pure (no Convex ctx, no network) so the server, the browser and
 * outside verifiers share one definition. See docs/action-records.md. */
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, concatBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import { verifyAsync } from "@noble/ed25519";

export const ACTION_RECORD_SCHEMA = "boop.action-record";
export const ACTION_RECORD_VERSION = 1;
// Domain-separates action signatures from the DID-log proofs the same key signs.
const SIGNING_DOMAIN = `${ACTION_RECORD_SCHEMA}/v${ACTION_RECORD_VERSION}`;

/** Row identity of the authenticated session or API key; never a token or hash. */
export type ActionCredential = { kind: "session" | "apiKey"; id: string };

type ListSubject = { listId: string; listAssetDid?: string };
type ItemSubject = ListSubject & { itemId: string };

/** What happened, and to what. Individual and batch operations build the same shape. */
export type ActionChange =
  | {
      action: "item.created";
      subject: ItemSubject;
      before: null;
      after: { name: string; checked: false };
      origin?: { kind: "recurrence"; sourceItemId: string } | { kind: "template"; source: string };
    }
  | {
      action: "item.completed";
      subject: ItemSubject;
      before: { checked: boolean };
      /** The item's stored checkedAt; null when the caller sent a non-finite number. */
      after: { checked: true; checkedAt: number | null };
    }
  | {
      action: "item.reopened";
      subject: ItemSubject;
      before: { checked: boolean };
      after: { checked: false };
    }
  | {
      action: "list.created";
      subject: ListSubject;
      before: null;
      after: { name: string; kind: "list" | "note" };
      origin?: { kind: "template"; source: string } | { kind: "copy"; sourceListId: string };
    }
  | {
      action: "list.renamed";
      subject: ListSubject;
      before: { name: string };
      after: { name: string };
    };

export type ActionType = ActionChange["action"];
const ACTION_TYPES: readonly string[] = [
  "item.created", "item.completed", "item.reopened", "list.created", "list.renamed",
] satisfies ActionType[];

export type ActionRecordPayload = ActionChange & {
  schema: typeof ACTION_RECORD_SCHEMA;
  version: typeof ACTION_RECORD_VERSION;
  /** Server time of the mutation, ms since epoch. */
  occurredAt: number;
  /** Account that owns the credential and authorized the action; not necessarily the list owner. */
  owner: { did: string; userId: string };
  credential: ActionCredential;
  /** Binding the signature is expected under: the owner's own Turnkey-held key. */
  signer: { did: string; custody: "turnkey"; keyType: "Ed25519" };
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
  verificationMethod?: string;
  publicKeyMultibase?: string;
  signedAt?: number;
  // Unsigned index columns; the verifier requires them to agree with the payload.
  listId?: string;
  itemId?: string;
  ownerUserId?: string;
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
export function actionRecordSigningInput(payload: string): Uint8Array {
  return concatBytes(sha256(utf8ToBytes(SIGNING_DOMAIN)), sha256(utf8ToBytes(payload)));
}

export function buildActionRecord(change: ActionChange, context: {
  occurredAt: number;
  owner: { did: string; userId: string };
  credential: ActionCredential;
}): { payload: string; digest: string } {
  const body: ActionRecordPayload = {
    ...change,
    schema: ACTION_RECORD_SCHEMA,
    version: ACTION_RECORD_VERSION,
    occurredAt: context.occurredAt,
    owner: { did: context.owner.did, userId: context.owner.userId },
    credential: { kind: context.credential.kind, id: context.credential.id },
    signer: { did: context.owner.did, custody: "turnkey", keyType: "Ed25519" },
  };
  const payload = canonicalize(body);
  return { payload, digest: actionRecordDigest(payload) };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Structural check of the envelope fields every version-1 payload carries. */
export function parseActionRecordPayload(payload: string): ActionRecordPayload | null {
  let parsed: unknown;
  try { parsed = JSON.parse(payload); } catch { return null; }
  if (!isRecord(parsed) || parsed.schema !== ACTION_RECORD_SCHEMA || parsed.version !== ACTION_RECORD_VERSION) return null;
  const { action, subject, owner, credential, signer, occurredAt } = parsed;
  if (typeof action !== "string" || !ACTION_TYPES.includes(action)) return null;
  if (!isRecord(subject) || typeof subject.listId !== "string") return null;
  if (action.startsWith("item.") !== (typeof subject.itemId === "string")) return null;
  if (!isRecord(owner) || typeof owner.did !== "string" || typeof owner.userId !== "string") return null;
  if (!isRecord(credential) || typeof credential.id !== "string"
    || (credential.kind !== "session" && credential.kind !== "apiKey")) return null;
  if (!isRecord(signer) || typeof signer.did !== "string" || signer.custody !== "turnkey" || signer.keyType !== "Ed25519") return null;
  if (typeof occurredAt !== "number" || !isRecord(parsed.after)) return null;
  return parsed as ActionRecordPayload;
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

function decodeSignature(signature: string): Uint8Array | null {
  const bytes = signature.startsWith("z") ? base58Decode(signature.slice(1)) : null;
  return bytes?.length === 64 ? bytes : null;
}

export async function verifyActionSignature(payload: string, signature: Uint8Array, publicKey: Uint8Array): Promise<boolean> {
  try {
    return await verifyAsync(signature, actionRecordSigningInput(payload), publicKey);
  } catch {
    return false;
  }
}

type TrustedKey = string | Uint8Array;
type MaybePromise<T> = T | Promise<T>;

export type VerifyActionRecordOptions = {
  /** Keys the caller already trusts, by owner DID. Keep rotated-out keys listed for older records. */
  trustedKeys?: Readonly<Record<string, readonly TrustedKey[]>>;
  /** Alternative lookup. The record's verification method is passed only as a hint. */
  resolvePublicKey?: (ownerDid: string, verificationMethod?: string) =>
    MaybePromise<TrustedKey | readonly TrustedKey[] | null | undefined>;
  /** Attribution the caller was shown; the signed payload must agree with it. */
  expected?: { ownerDid?: string; credential?: ActionCredential };
};

export type VerifyFailure =
  | "not_signed"
  | "malformed_payload"
  | "non_canonical_payload"
  | "digest_mismatch"
  | "binding_mismatch"
  | "no_trusted_key"
  | "untrusted_key"
  | "bad_signature";

export type VerifyActionRecordResult =
  | { verified: true; payload: ActionRecordPayload; publicKeyMultibase: string }
  | { verified: false; reason: VerifyFailure };

const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((byte, i) => byte === b[i]);

/**
 * Checks one record against keys the CALLER trusts for the payload's owner DID.
 * A key carried by the record itself only selects among those; it is never trusted.
 */
export async function verifyActionRecord(
  record: ActionRecordEvidence,
  options: VerifyActionRecordOptions,
): Promise<VerifyActionRecordResult> {
  const fail = (reason: VerifyFailure): VerifyActionRecordResult => ({ verified: false, reason });

  const signature = record.status === "signed" && record.signature ? decodeSignature(record.signature) : null;
  if (!signature) return fail("not_signed");

  const payload = parseActionRecordPayload(record.payload);
  if (!payload) return fail("malformed_payload");
  let canonical: string;
  try { canonical = canonicalize(JSON.parse(record.payload)); } catch { return fail("malformed_payload"); }
  if (canonical !== record.payload) return fail("non_canonical_payload");
  if (actionRecordDigest(record.payload) !== record.digest) return fail("digest_mismatch");

  const itemId = "itemId" in payload.subject ? payload.subject.itemId : undefined;
  if (payload.signer.did !== payload.owner.did
    || (record.listId !== undefined && record.listId !== payload.subject.listId)
    || (record.itemId !== undefined && record.itemId !== itemId)
    || (record.ownerUserId !== undefined && record.ownerUserId !== payload.owner.userId)) return fail("binding_mismatch");
  const { expected } = options;
  if (expected?.ownerDid !== undefined && expected.ownerDid !== payload.owner.did) return fail("binding_mismatch");
  if (expected?.credential && (expected.credential.kind !== payload.credential.kind
    || expected.credential.id !== payload.credential.id)) return fail("binding_mismatch");

  const declared = [record.publicKeyMultibase, record.verificationMethod]
    .filter((key): key is string => key !== undefined).map(parseEd25519PublicKey);
  if (declared.some(key => key === null) || (declared.length === 2 && !sameBytes(declared[0]!, declared[1]!))) {
    return fail("binding_mismatch");
  }

  const resolved = await options.resolvePublicKey?.(payload.owner.did, record.verificationMethod);
  const supplied: readonly TrustedKey[] = [
    ...(options.trustedKeys?.[payload.owner.did] ?? []),
    ...(resolved == null ? [] : typeof resolved === "string" || resolved instanceof Uint8Array ? [resolved] : resolved),
  ];
  const trusted = supplied.map(parseEd25519PublicKey).filter((key): key is Uint8Array => key !== null);
  if (trusted.length === 0) return fail("no_trusted_key");

  const candidates = declared[0] ? trusted.filter(key => sameBytes(key, declared[0]!)) : trusted;
  if (candidates.length === 0) return fail("untrusted_key");
  for (const key of candidates) {
    if (await verifyActionSignature(record.payload, signature, key)) {
      return { verified: true, payload, publicKeyMultibase: ed25519Multikey(key) };
    }
  }
  return fail("bad_signature");
}
