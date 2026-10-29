/**
 * Originals 5 signing without the key (#286 PR b).
 *
 * `keySigner` from `@originals/sdk/originals` holds raw key bytes. boop's
 * assertion key lives in Turnkey and is only usable through the author's
 * client-side session, so this is `keySigner` with the key replaced by a
 * `signBytes` callback: the same request checks, the same refusals, and the
 * same signed bytes (`proofHashData` for eddsa-jcs-2022).
 *
 * main is still on @originals/sdk 4, so the SDK 5 types this needs are
 * declared here, shape-compatible with @originals/sdk 5.1.0 /
 * @originals/vh 0.3.0. Once SDK 5 is installed (PR e, #298) these can be
 * replaced by the SDK's own types without changing any caller. Ported from:
 *   @originals/sdk/dist/originals/signer.js  (summarize, describeEntry, checkRequest, keySigner)
 *   @originals/vh/dist/crypto/index.js       (proofConfig, proofHashData)
 *   @originals/vh/dist/log/index.js          (vhHash)
 *   @originals/vh/dist/json/index.js         (canonicalize, RFC 8785)
 * scripts/originals-author-sdk5.test.mjs checks this against the real SDK.
 */
import { MultibaseEncoding, multibaseEncode } from "didwebvh-ts";

export const ORIGINALS_METHOD = "originals:1.0";
export const ORIGINALS_CRYPTOSUITE = "eddsa-jcs-2022";

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
type JsonObject = { [key: string]: JsonValue };

/** @originals/vh `AuthorRef`: a DID, one of its verification methods, and the DID version that names it. */
export interface AuthorRef {
  did: string;
  verificationMethod: string;
  versionId: string;
}

/** The part of @originals/vh `AuthorDidEvidence` boop supplies: the author's whole did:webvh log. */
export interface AuthorDidEvidence {
  did: string;
  log?: string | unknown[];
  obtainedAt?: string;
  source?: "package" | "host" | "fetched" | "retained" | "supplied";
}

export interface Transition {
  resource: string;
  from: string | null;
  to: string | null;
}

export interface EntrySummary {
  original: string;
  operation: "create" | "update" | "deactivate";
  name: string;
  author: AuthorRef;
  signer: AuthorRef & { role: "author" | "editor" };
  changes: Transition[];
  nameChanged: boolean;
  metadataChanged: boolean;
  editorsChanged: boolean;
  editors: Array<{ did: string; name?: boolean; metadata?: boolean; resources: string[] }>;
  versionTime: string;
}

/** Everything in a Data Integrity proof except proofValue. */
export interface ProofOptions {
  type: string;
  cryptosuite: string;
  verificationMethod: string;
  proofPurpose: string;
  [member: string]: unknown;
}

/** @originals/sdk `SigningRequest`. `entry` is an unsigned VH-Log entry. */
export interface SigningRequest {
  entry: Record<string, unknown>;
  proofOptions: ProofOptions;
  summary: EntrySummary;
  display: string;
  parent?: { entry: Record<string, unknown>; predecessor?: string };
}

/** @originals/sdk `OriginalsSigner`. */
export interface OriginalsSigner {
  readonly verificationMethod: string;
  readonly cryptosuite: "eddsa-jcs-2022" | "bip340-jcs-2025";
  sign(request: SigningRequest): Promise<Uint8Array>;
}

/** What PR e's `setListAuthorSource` expects (src/lib/originals.ts on feat/originals-sdk-5). */
export interface ListAuthor {
  author: AuthorRef;
  signer: OriginalsSigner;
  evidence: AuthorDidEvidence;
}

/** Mirrors @originals/vh `OriginalsError` codes so callers can tell a refusal from a failure. */
export class OriginalsSigningError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "OriginalsSigningError";
  }
}

// ---------------------------------------------------------------------------
// JCS, hashes and the eddsa-jcs-2022 signing input

function hasLoneSurrogate(text: string): boolean {
  for (let i = 0; i < text.length; i += 1) {
    const unit = text.charCodeAt(i);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) { i += 1; continue; }
      return true;
    }
    if (unit >= 0xdc00 && unit <= 0xdfff) return true;
  }
  return false;
}

function unsupported(message: string): never {
  throw new OriginalsSigningError("JCS_UNSUPPORTED_VALUE", message);
}

/** RFC 8785 JSON Canonicalization Scheme, as @originals/vh implements it. */
export function canonicalize(value: unknown): string {
  switch (typeof value) {
    case "string":
      if (hasLoneSurrogate(value)) unsupported("string contains a lone surrogate");
      return JSON.stringify(value);
    case "number":
      if (!Number.isFinite(value) || Object.is(value, -0)) unsupported(`number ${String(value)} is not canonicalizable`);
      return JSON.stringify(value);
    case "boolean":
      return value ? "true" : "false";
    case "object": {
      if (value === null) return "null";
      if (Array.isArray(value)) return `[${value.map(item => canonicalize(item)).join(",")}]`;
      const proto = Object.getPrototypeOf(value);
      if (proto !== Object.prototype && proto !== null) unsupported("only plain objects are JSON objects");
      const object = value as Record<string, unknown>;
      return `{${Object.keys(object).sort().map(key => {
        const item = object[key];
        if (item === undefined) unsupported(`member ${JSON.stringify(key)} is undefined`);
        if (hasLoneSurrogate(key)) unsupported("key contains a lone surrogate");
        return `${JSON.stringify(key)}:${canonicalize(item)}`;
      }).join(",")}}`;
    }
    default:
      return unsupported(`${typeof value} is not a JSON value`);
  }
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as BufferSource));
}

const canonicalBytes = (value: unknown) => new TextEncoder().encode(canonicalize(value));

/** `base58btc(multihash(JCS(value), sha2-256))`, the VH-Log hash form. */
export async function vhHash(value: unknown): Promise<string> {
  const multihash = new Uint8Array(34);
  multihash[0] = 0x12;
  multihash[1] = 32;
  multihash.set(await sha256(canonicalBytes(value)), 2);
  return multibaseEncode(multihash, MultibaseEncoding.BASE58_BTC).slice(1);
}

/** Members Data Integrity defines for a proof. Anything else is refused (P5.7). */
const PROOF_MEMBERS = new Set([
  "@context", "id", "type", "cryptosuite", "verificationMethod", "proofPurpose",
  "created", "expires", "domain", "challenge", "nonce", "previousProof", "proofValue",
]);

function withoutUndefined(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined));
}

function proofConfig(document: Record<string, unknown>, options: Record<string, unknown>): Record<string, unknown> {
  const config: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(options)) {
    if (value === undefined || key === "proofValue") continue;
    if (!PROOF_MEMBERS.has(key)) throw new OriginalsSigningError("PROOF_UNKNOWN_MEMBER", `proof member ${JSON.stringify(key)} is not defined by Data Integrity`);
    config[key] = value;
  }
  if (config.type !== "DataIntegrityProof") throw new OriginalsSigningError("PROOF_INVALID", "proof type must be DataIntegrityProof");
  // This signer holds an Ed25519 key, so it only ever produces eddsa-jcs-2022.
  if (config.cryptosuite !== ORIGINALS_CRYPTOSUITE) throw new OriginalsSigningError("CRYPTOSUITE_UNSUPPORTED", `cryptosuite ${JSON.stringify(config.cryptosuite)} is not permitted`);
  if (typeof config.verificationMethod !== "string" || typeof config.proofPurpose !== "string") {
    throw new OriginalsSigningError("PROOF_INVALID", "proof needs verificationMethod and proofPurpose strings");
  }
  if (document["@context"] !== undefined && config["@context"] === undefined) config["@context"] = document["@context"];
  return config;
}

/**
 * The bytes an eddsa-jcs-2022 signer signs for `document` under `options`:
 * sha256(JCS(proof config)) || sha256(JCS(document without proof)).
 */
export async function proofHashData(document: Record<string, unknown>, options: Record<string, unknown>): Promise<Uint8Array> {
  if (!isJsonObject(document)) throw new OriginalsSigningError("PROOF_INVALID", "document must be a JSON object");
  const unsecured = withoutUndefined(document);
  delete unsecured.proof;
  const config = proofConfig(unsecured, options);
  const joined = new Uint8Array(64);
  joined.set(await sha256(canonicalBytes(config)), 0);
  joined.set(await sha256(canonicalBytes(unsecured)), 32);
  return joined;
}

// ---------------------------------------------------------------------------
// What the signer shows and checks (P5.11)

const same = (a: unknown, b: unknown) => canonicalize(a ?? null) === canonicalize(b ?? null);

type EntryState = {
  id: string;
  operation: EntrySummary["operation"];
  author: AuthorRef;
  editor?: AuthorRef;
  transitions: Transition[];
  asset: { name: string; metadata?: JsonObject; editors?: EntrySummary["editors"] };
};

export function summarize(entry: Record<string, unknown>, previous?: EntryState): EntrySummary {
  const state = entry.state as EntryState;
  const signer = state.editor ?? state.author;
  return {
    original: state.id,
    operation: state.operation,
    name: state.asset.name,
    author: state.author,
    signer: { role: state.editor ? "editor" : "author", did: signer.did, verificationMethod: signer.verificationMethod, versionId: signer.versionId },
    changes: state.transitions,
    nameChanged: previous ? previous.asset.name !== state.asset.name : true,
    metadataChanged: previous ? !same(previous.asset.metadata, state.asset.metadata) : state.asset.metadata !== undefined,
    editorsChanged: previous ? !same(previous.asset.editors, state.asset.editors) : state.asset.editors !== undefined,
    editors: state.asset.editors ?? [],
    versionTime: entry.versionTime as string,
  };
}

/** The text a signer shows before signing. Identical to the SDK's (PROVISIONAL wording there). */
export function describeEntry(summary: EntrySummary): string {
  const s = summary.signer;
  const lines = [
    `Signing as ${s.role} ${s.did} with ${s.verificationMethod} (DID version ${s.versionId})`,
    `Original: ${summary.original} "${summary.name}"`,
    `Operation: ${summary.operation}`,
    `Author: ${summary.author.did}${s.role === "editor" ? " (unchanged; an editor entry carries its parent's author)" : ""}`,
  ];
  if (summary.changes.length === 0) lines.push("Resources: no change");
  for (const c of summary.changes) {
    if (c.from === null) lines.push(`Resource ${c.resource}: added ${c.to}`);
    else if (c.to === null) lines.push(`Resource ${c.resource}: removed (was ${c.from}; its earlier versions stay in history)`);
    else lines.push(`Resource ${c.resource}: ${c.from} -> ${c.to}`);
  }
  if (summary.nameChanged) lines.push(`Name: changed to ${JSON.stringify(summary.name)}`);
  if (summary.metadataChanged) lines.push("Metadata: changed");
  if (summary.editorsChanged) {
    const grants = summary.editors ?? [];
    lines.push(`Editor grants: changed${grants.length === 0 ? " (none remain)" : ""}`);
    for (const g of grants) {
      lines.push(`  ${g.did}: name ${g.name ? "yes" : "no"}, metadata ${g.metadata ? "yes" : "no"}, resources ${g.resources.length > 0 ? g.resources.join(", ") : "none"}`);
    }
  }
  return lines.join("\n");
}

function refuse(message: string): never {
  throw new OriginalsSigningError("SIGNER_REFUSED", message);
}

const VERSION_ID = /^(\d+)-(.+)$/;

/** True when `entry`'s versionId is its hash over `predecessor`, as VH-Log chains entries. */
async function chainsTo(entry: Record<string, unknown> | undefined, predecessor: unknown): Promise<boolean> {
  const id = VERSION_ID.exec(String(entry?.versionId));
  if (!id || typeof predecessor !== "string" || !entry) return false;
  const unsigned: Record<string, unknown> = { ...entry, versionId: predecessor };
  delete unsigned.proof;
  try {
    return (await vhHash(unsigned)) === id[2];
  } catch {
    return false;
  }
}

async function parentState(request: SigningRequest, number: number): Promise<EntryState | undefined | "unknown"> {
  if (number === 1) return undefined;
  const parent = request.parent;
  if (!parent) return "unknown";
  const p = parent.entry;
  const pid = VERSION_ID.exec(String(p?.versionId));
  if (!pid || Number(pid[1]) !== number - 1 || !(await chainsTo(request.entry, p.versionId))) refuse("the parent does not chain to this entry");
  const predecessor = Number(pid[1]) === 1 ? (isJsonObject(p.parameters) ? p.parameters.scid : undefined) : parent.predecessor;
  if (!(await chainsTo(p, predecessor))) refuse("the parent is not the entry its versionId names");
  return p.state as EntryState;
}

/**
 * Refuse anything that is not a well-formed Originals entry for this
 * verification method, or whose summary misstates it. Returns the summary
 * derived from the entry and its bound parent, which is what gets shown.
 */
async function checkRequest(request: SigningRequest, verificationMethod: string): Promise<EntrySummary> {
  const { entry, proofOptions } = request;
  if (proofOptions?.verificationMethod !== verificationMethod || proofOptions.cryptosuite !== ORIGINALS_CRYPTOSUITE || proofOptions.proofPurpose !== "assertionMethod") {
    refuse("the proof options are not this key's");
  }
  const number = Number(/^(\d+)-/.exec(String(entry?.versionId))?.[1] ?? NaN);
  const parameters = (entry?.parameters ?? {}) as Record<string, unknown>;
  if (!Number.isInteger(number) || typeof entry.versionTime !== "string") refuse("not a VH log entry");
  if (number === 1 ? parameters.method !== ORIGINALS_METHOD : parameters.method !== undefined && parameters.method !== ORIGINALS_METHOD) {
    refuse("not an Originals entry");
  }
  const state = entry.state as EntryState | undefined;
  const author = state?.author;
  const editor = state?.editor;
  if (typeof state?.id !== "string" || !state.id.startsWith("did:vh:") || !["create", "update", "deactivate"].includes(state.operation)) {
    refuse("not an Originals asset state");
  }
  const signer = editor ?? author;
  if (signer?.verificationMethod !== verificationMethod) refuse(`the entry names another ${editor ? "editor" : "author"} key`);
  const summary = request.summary;
  const role = editor ? "editor" : "author";
  if (!summary || summary.original !== state.id || summary.operation !== state.operation
    || summary.signer?.role !== role
    || !same({ did: summary.signer.did, verificationMethod: summary.signer.verificationMethod, versionId: summary.signer.versionId }, signer)
    || !same(summary.author, author) || !same(summary.changes, state.transitions)) {
    refuse("the summary does not state this entry: who signs, the Original, the operation or the resource changes");
  }
  const parent = await parentState(request, number);
  const derived = summarize(entry, parent === "unknown" ? undefined : parent);
  const checked: Array<keyof EntrySummary> = ["name", "editors", "versionTime", ...(parent === "unknown" ? [] : ["nameChanged", "metadataChanged", "editorsChanged"] as const)];
  for (const field of checked) {
    if (!same(summary[field], derived[field])) refuse(`the summary does not state this entry: ${field}`);
  }
  return parent === "unknown" ? { ...derived, nameChanged: true, metadataChanged: true, editorsChanged: true } : derived;
}

export interface RemoteKeySignerOptions {
  /** The verification method this key is, e.g. `did:webvh:…#orig-1`. */
  verificationMethod: string;
  /** Ed25519-sign exactly these bytes with the key behind `verificationMethod`. */
  signBytes(data: Uint8Array): Promise<Uint8Array>;
  /** As keySigner's `confirm`: show `display` (recomputed here) and return false to refuse. */
  confirm?: (display: string, summary: EntrySummary) => boolean | Promise<boolean>;
}

/** `keySigner` for a key this process cannot read. Refuses exactly what keySigner refuses. */
export function remoteKeySigner(options: RemoteKeySignerOptions): OriginalsSigner {
  if (!/^did:[a-z0-9]+:[^#]+#[^#]+$/.test(options.verificationMethod)) {
    throw new OriginalsSigningError("SIGNER_INVALID", "verificationMethod must be an absolute DID URL with a fragment");
  }
  return {
    verificationMethod: options.verificationMethod,
    cryptosuite: ORIGINALS_CRYPTOSUITE,
    sign: async (untrusted) => {
      // Check, show and sign one private copy: the checks await, and the
      // caller must not be able to change the entry in between.
      const request = structuredClone(untrusted);
      const derived = await checkRequest(request, options.verificationMethod);
      if (options.confirm && !(await options.confirm(describeEntry(derived), derived))) refuse("the signer declined");
      const signature = await options.signBytes(await proofHashData(request.entry, request.proofOptions));
      if (signature.length !== 64) throw new OriginalsSigningError("SIGNATURE_INVALID", "Ed25519 signature must be 64 bytes");
      return signature;
    },
  };
}
