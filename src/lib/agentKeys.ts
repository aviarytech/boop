/**
 * Agent keys in the author's did:webvh (docs/lws-agent-auth.md, "App").
 *
 * Approving an LWS agent adds its key to the DID as `#agent-<id>`, referenced
 * from `authentication` only; revoking one removes it. Each change is one new
 * did:webvh entry built by didwebvh-ts `updateDID` from the state
 * shared/authorDid.ts `nextAgentDocument` gives, signed through the Turnkey
 * session by the author key (`#key-0`, the DID's only update key) and POSTed
 * to /api/did/log as a continuation of the served log. Never the assertion
 * key: it is not an update key, so the server would refuse it anyway.
 *
 * Every change starts from the log the server serves now, checked as the
 * server checks it, and is idempotent: a key already added (or already
 * removed) publishes nothing. So a retry after a failure later in the flow,
 * e.g. `approveAccessRequest`, needs no signature and no Turnkey session.
 */
import { updateDID } from "didwebvh-ts";
import type { DIDLog, VerificationMethod } from "didwebvh-ts";
import { agentMethods, nextAgentDocument, type AgentMethodChange, type DidDocumentLike } from "../../shared/authorDid";
import { parseCanonicalDidLog } from "../../shared/didLogSignatures";
import { authorUpdateSigner, inspectAuthorDid, type AuthorKeyBackend, type AuthorKeys } from "./authorDid";
import { userDidPath } from "./webvh";
import { getConvexHttpUrl } from "./convexUrls";

/** The parts of the signed-in author (authorIdentity.ts CurrentAuthor) a DID update needs. */
export interface AgentKeyAuthor {
  subOrgId: string;
  did: string;
  keys: AuthorKeys;
}

export interface AgentKeyDeps {
  backend: AuthorKeyBackend;
  /** Whether the Turnkey session can sign now; asked only when a signature is needed. */
  ready(subOrgId: string): Promise<boolean>;
  fetch: typeof fetch;
  httpUrl: string;
  /** The boop session JWT, for POST /api/did/log. */
  token: string;
}

export type AgentKeyStep = "signing" | "saving";

export type AgentKeyErrorCode =
  /** No live Turnkey session: sign in again. */
  | "not-ready"
  /** The served log isn't this account's author DID, so it can't be continued from here. */
  | "not-author"
  /** The server refused the update, or couldn't be reached. */
  | "rejected";

export class AgentKeyError extends Error {
  readonly code: AgentKeyErrorCode;
  constructor(code: AgentKeyErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = "AgentKeyError";
  }
}

export interface AgentKeyResult {
  did: string;
  /** The served log after the change. */
  log: string;
  versionId: string;
  /** False when the DID already had the change, so nothing was signed or posted. */
  changed: boolean;
}

/** A fresh copy of the log this account's path serves. */
export async function fetchServedDidLog(deps: Pick<AgentKeyDeps, "fetch" | "httpUrl">, subOrgId: string): Promise<string> {
  const path = userDidPath(subOrgId);
  let response: Response;
  try {
    response = await deps.fetch(`${deps.httpUrl}/api/did/log?path=${encodeURIComponent(path)}`, { cache: "no-store" });
  } catch {
    throw new AgentKeyError("rejected", "Couldn't reach boop to read your DID. Check your connection and try again.");
  }
  if (response.status === 404) throw new AgentKeyError("not-author", "Your account has no DID yet.");
  if (!response.ok) throw new AgentKeyError("rejected", `Couldn't read your DID (${response.status}).`);
  return response.text();
}

/** The latest state of a canonical log, and the update keys in force after it. */
function head(log: DIDLog): { state: DidDocumentLike & Record<string, unknown>; updateKeys: string[] } {
  let updateKeys: string[] = [];
  for (const entry of log as Array<{ parameters?: { updateKeys?: unknown } }>) {
    if (Array.isArray(entry.parameters?.updateKeys)) updateKeys = entry.parameters.updateKeys as string[];
  }
  return { state: (log[log.length - 1] as unknown as { state: DidDocumentLike & Record<string, unknown> }).state, updateKeys };
}

/** Whether `change` is already true of `state`: then there is nothing to publish. */
function alreadyApplied(state: DidDocumentLike, change: AgentMethodChange): boolean {
  const methods = agentMethods(state);
  if ("add" in change) return methods.some(m => m.fragment === change.add.fragment && m.publicKeyMultibase === change.add.publicKeyMultibase);
  return !methods.some(m => m.fragment === change.remove);
}

/** JSON with object keys sorted, to compare documents whatever order didwebvh-ts writes members in. */
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable((value as Record<string, unknown>)[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/**
 * The served log extended by one entry that makes `change`, signed by the
 * author key; null when the served state already has it. Throws AgentKeyError
 * when the served log isn't this account's author DID, or Turnkey can't sign.
 */
export async function buildAgentUpdate(
  author: AgentKeyAuthor,
  served: string,
  change: AgentMethodChange,
  deps: Pick<AgentKeyDeps, "backend" | "ready">,
  onStep?: (step: AgentKeyStep) => void,
): Promise<{ jsonl: string; versionId: string; doc: DidDocumentLike } | null> {
  const inspected = await inspectAuthorDid(served, author.keys);
  if (inspected.problems.length > 0 || inspected.did !== author.did) {
    throw new AgentKeyError("not-author", `The DID boop serves for you isn't one this device can update${inspected.problems.length ? `: ${inspected.problems.join("; ")}` : ""}.`);
  }
  const log = parseCanonicalDidLog(served);
  const { state, updateKeys } = head(log);
  if (alreadyApplied(state, change)) return null;
  // Throws AgentMethodError for a change that wouldn't leave an author DID.
  const next = nextAgentDocument(state, updateKeys, change);

  if (!(await deps.ready(author.subOrgId))) throw new AgentKeyError("not-ready", "Sign in again to change your agents: your secure signing session has ended.");
  onStep?.("signing");
  const signer = authorUpdateSigner(deps.backend, author.subOrgId, author.keys.author);
  // updateKeys unchanged and passed explicitly (updateDID writes [] when it is
  // left out). No witness, watchers or pre-rotation; paths and portable are
  // genesis-only and stay as they are. Members the state carries besides keys
  // (service, alsoKnownAs) are passed through, so only the keys change.
  const result = await updateDID({
    log,
    signer,
    verifier: signer,
    updateKeys,
    verificationMethods: next.verificationMethod as VerificationMethod[],
    authentication: next.authentication as string[],
    assertionMethod: next.assertionMethod as string[],
    ...(Array.isArray(state.service) && state.service.length > 0 ? { services: state.service as never } : {}),
    ...(Array.isArray(state.alsoKnownAs) ? { alsoKnownAs: state.alsoKnownAs as string[] } : {}),
  });
  const entry = result.log[result.log.length - 1] as unknown as { versionId: string; state: unknown };
  if (stable(entry.state) !== stable(next)) throw new AgentKeyError("rejected", "The DID update changes more than this agent's key.");

  // Served bytes stay exactly as served; the new entry is one canonical line.
  const jsonl = `${served.endsWith("\n") ? served.slice(0, -1) : served}\n${JSON.stringify(entry)}`;
  const check = await inspectAuthorDid(jsonl, author.keys);
  if (check.problems.length > 0 || check.versionId !== entry.versionId) {
    throw new AgentKeyError("rejected", `The DID update doesn't verify: ${check.problems.join("; ") || "wrong version"}.`);
  }
  return { jsonl, versionId: entry.versionId, doc: result.doc as DidDocumentLike };
}

/**
 * Publish `change` to this account's DID: build it from the served log, POST
 * it, and on a 409 (someone else extended the log first) start again from
 * the new served log, once.
 */
export async function publishAgentChange(
  author: AgentKeyAuthor,
  change: AgentMethodChange,
  deps: AgentKeyDeps,
  onStep?: (step: AgentKeyStep) => void,
): Promise<AgentKeyResult> {
  for (let attempt = 0; ; attempt++) {
    const served = await fetchServedDidLog(deps, author.subOrgId);
    const built = await buildAgentUpdate(author, served, change, deps, onStep);
    if (!built) {
      const { versionId } = await inspectAuthorDid(served, author.keys);
      return { did: author.did, log: served, versionId, changed: false };
    }
    onStep?.("saving");
    let response: Response;
    try {
      response = await deps.fetch(`${deps.httpUrl}/api/did/log`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${deps.token}` },
        credentials: "include",
        body: JSON.stringify({ userDid: author.did, path: userDidPath(author.subOrgId), log: built.jsonl }),
      });
    } catch {
      throw new AgentKeyError("rejected", "Couldn't reach boop to save your DID. Check your connection and try again.");
    }
    if (response.ok) return { did: author.did, log: built.jsonl, versionId: built.versionId, changed: true };
    if (response.status === 409 && attempt === 0) continue;
    const detail = await response.json().then((body: { error?: unknown }) => (typeof body?.error === "string" ? body.error : ""), () => "");
    throw new AgentKeyError("rejected", `boop didn't save the DID update (${response.status})${detail ? `: ${detail}` : ""}.`);
  }
}

/** Add an approved agent's key as `#<fragment>`. */
export function addAgentKey(author: AgentKeyAuthor, key: { fragment: string; publicKeyMultibase: string }, deps: AgentKeyDeps, onStep?: (step: AgentKeyStep) => void) {
  return publishAgentChange(author, { add: key }, deps, onStep);
}

/** Remove `#<fragment>` from the DID. */
export function removeAgentKey(author: AgentKeyAuthor, fragment: string, deps: AgentKeyDeps, onStep?: (step: AgentKeyStep) => void) {
  return publishAgentChange(author, { remove: fragment }, deps, onStep);
}

/**
 * The agent methods the served DID lists, set against the owner's agents:
 * a method no active agent and no pending request holds is a revoked agent's
 * key still in the DID (its removal failed), to be removed again.
 */
export function strayAgentMethods(
  served: DidDocumentLike | null,
  active: Array<{ fragment: string }>,
  pending: Array<{ fragment: string }>,
): Array<{ fragment: string; publicKeyMultibase: string }> {
  if (!served) return [];
  const held = new Set([...active, ...pending].map(row => row.fragment));
  return agentMethods(served).filter(m => !held.has(m.fragment)).map(({ fragment, publicKeyMultibase }) => ({ fragment, publicKeyMultibase }));
}

/** The latest state of a served log, or null when it doesn't parse. */
export function servedDocument(jsonl: string): DidDocumentLike | null {
  try { return head(parseCanonicalDidLog(jsonl)).state; } catch { return null; }
}

/** `did:key:z6Mk…` → `z6Mk…a1b2c3`: enough to tell keys apart at a glance. */
export function shortKey(didKey: string): string {
  const key = didKey.replace(/^did:key:/, "").split("#")[0];
  return key.length > 14 ? `${key.slice(0, 4)}…${key.slice(-6)}` : key;
}

/**
 * This account's LWS storage, `B/lws/{u}`, which an agent names in its access
 * request. `B` is VITE_LWS_BASE_URL when the deployment sets LWS_BASE_URL,
 * else the Convex site URL (convex/lib/lwsUrls.ts lwsBaseUrl).
 */
export function storageUrl(subOrgId: string): string {
  const base = ((import.meta.env.VITE_LWS_BASE_URL as string | undefined) || getConvexHttpUrl()).replace(/\/+$/, "");
  return `${base}/lws/${userDidPath(subOrgId)}`;
}
