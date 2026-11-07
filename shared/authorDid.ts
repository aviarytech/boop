/**
 * The shape of an author did:webvh under #286, shared by the client that
 * mints it and the server that stores it.
 *
 * Two Turnkey Ed25519 keys in the author's own sub-org, both usable only
 * through the author's client-side Turnkey session:
 * - the author key (`#key-0`) is the DID's only update key and signs DID
 *   updates, nothing else;
 * - the assertion key (`#orig-1`) is in `assertionMethod` and signs Originals
 *   entries. Originals 5 refuses an assertion key that is also an update key.
 * Every verification method's controller is the DID itself (Originals 5,
 * P5.3/P5.14); at genesis it is written with the `{SCID}` placeholder.
 *
 * Besides those two, a DID may list agent methods (docs/lws-agent-auth.md):
 * `#agent-<10 base32 chars>`, an Ed25519 Multikey an approved LWS agent holds,
 * referenced from `authentication` only. Never an update key and never in
 * `assertionMethod`, so an agent can sign in as the author over LWS but can
 * neither update the DID nor sign Originals or action records.
 */
import { isEd25519Multikey } from "./multikey";

/** BIP32 paths of the two Ed25519 accounts in the sub-org's default wallet. */
export const AUTHOR_KEY_PATH = "m/44'/501'/0'/0'";
export const ASSERTION_KEY_PATH = "m/44'/501'/1'/0'";

export const AUTHOR_VM_FRAGMENT = "key-0";
export const ASSERTION_VM_FRAGMENT = "orig-1";

/** An agent method's fragment: `agent-` and 10 lowercase RFC 4648 base32 characters. */
export const AGENT_VM_PATTERN = /^agent-[a-z2-7]{10}$/;
export const MAX_AGENT_METHODS = 25;

export function isAgentFragment(fragment: unknown): fragment is string {
  return typeof fragment === "string" && AGENT_VM_PATTERN.test(fragment);
}

interface VerificationMethodLike {
  id?: string;
  type?: string;
  controller?: string;
  publicKeyMultibase?: string;
}

export interface DidDocumentLike {
  id?: string;
  verificationMethod?: VerificationMethodLike[];
  assertionMethod?: Array<string | VerificationMethodLike>;
  authentication?: Array<string | VerificationMethodLike>;
  capabilityInvocation?: unknown[];
  capabilityDelegation?: unknown[];
  keyAgreement?: unknown[];
}

/** All a boop verification method carries: anything else (publicKeyJwk...) is a second key description. */
const VERIFICATION_METHOD_MEMBERS = new Set(["id", "type", "controller", "publicKeyMultibase"]);

/** Parameters a boop DID log may carry. Anything else (witnesses, pre-rotation, watchers...) is refused. */
export const ALLOWED_LOG_PARAMETERS = new Set(["method", "scid", "updateKeys", "portable", "deactivated", "ttl", "nextKeyHashes", "witness", "watchers"]);

const absolute = (did: string, ref: string) => (ref.startsWith("#") ? `${did}${ref}` : ref);

/** The fragment of a method id that names `did` (relative `#x` or absolute `did#x`), else null. */
function fragmentOf(did: string, id: string): string | null {
  const full = absolute(did, id);
  return full.startsWith(`${did}#`) ? full.slice(did.length + 1) : null;
}

/** A DID document's agent methods, in document order: only well-formed ids are returned. */
export function agentMethods(doc: DidDocumentLike): Array<{ fragment: string; id: string; publicKeyMultibase: string }> {
  const did = doc.id;
  if (!did) return [];
  return (doc.verificationMethod ?? []).flatMap(vm => {
    const fragment = fragmentOf(did, vm.id ?? "");
    return isAgentFragment(fragment) && typeof vm.publicKeyMultibase === "string"
      ? [{ fragment, id: `${did}#${fragment}`, publicKeyMultibase: vm.publicKeyMultibase }]
      : [];
  });
}

/**
 * Everything that keeps this document from being an author DID, empty when it
 * is one. `expect` pins the keys when the caller knows them.
 */
export function authorDidProblems(
  doc: DidDocumentLike,
  updateKeys: string[],
  expect: { authorKey?: string; assertionKey?: string } = {}
): string[] {
  const problems: string[] = [];
  const did = doc.id;
  if (!did || !did.startsWith("did:webvh:")) return ["not a did:webvh document"];

  const methods = doc.verificationMethod ?? [];
  for (const vm of methods) {
    if (vm.controller !== did) problems.push(`${vm.id ?? "a verification method"} is not controlled by the DID`);
  }
  // Relationships only reference the two methods: an embedded method there is
  // a key description other verifiers would bind (#300 review).
  for (const relationship of ["assertionMethod", "authentication"] as const) {
    if ((doc[relationship] ?? []).some(ref => typeof ref !== "string")) problems.push(`${relationship} embeds a verification method`);
  }
  const byId = new Map(methods.map(vm => [absolute(did, vm.id ?? ""), vm]));
  // A Map keeps the last of duplicate ids, but a verifier may bind the first (#300 review).
  if (byId.size !== methods.length) problems.push("two verification methods share an id");
  for (const vm of methods) {
    const extra = Object.keys(vm).filter(member => !VERIFICATION_METHOD_MEMBERS.has(member));
    if (extra.length > 0) problems.push(`${vm.id ?? "a verification method"} carries ${extra.join(", ")}`);
  }
  const assertionId = `${did}#${ASSERTION_VM_FRAGMENT}`;
  const assertionRefs = (doc.assertionMethod ?? []).map(ref => absolute(did, typeof ref === "string" ? ref : ref.id ?? ""));
  const assertion = byId.get(assertionId);
  if (!assertion || !assertionRefs.includes(assertionId)) problems.push(`#${ASSERTION_VM_FRAGMENT} is not an assertionMethod`);
  if (assertion && assertion.type !== "Multikey") problems.push(`#${ASSERTION_VM_FRAGMENT} is not a Multikey`);

  for (const ref of assertionRefs) {
    const key = byId.get(ref)?.publicKeyMultibase;
    if (key && updateKeys.includes(key)) problems.push(`${ref} is also an update key`);
  }
  if (updateKeys.length !== 1) problems.push("an author DID has exactly one update key");
  if (expect.authorKey && updateKeys[0] !== expect.authorKey) problems.push("the update key is not this account's author key");
  if (expect.assertionKey && assertion?.publicKeyMultibase !== expect.assertionKey) {
    problems.push(`#${ASSERTION_VM_FRAGMENT} is not this account's assertion key`);
  }

  // Exactly the two keys, each in its one relationship, plus agent methods
  // in authentication only: no other key anyone could sign with as this
  // author (#300 review).
  const authorId = `${did}#${AUTHOR_VM_FRAGMENT}`;
  const ids = [...byId.keys()];
  if (!byId.has(authorId) || !byId.has(assertionId)) {
    problems.push(`verification methods must include #${AUTHOR_VM_FRAGMENT} and #${ASSERTION_VM_FRAGMENT}`);
  }
  const agentIds = new Set<string>();
  for (const id of ids) {
    if (id === authorId || id === assertionId) continue;
    if (isAgentFragment(fragmentOf(did, id))) agentIds.add(id);
    else problems.push(`verification methods must be #${AUTHOR_VM_FRAGMENT}, #${ASSERTION_VM_FRAGMENT} and agent methods only (${id})`);
  }
  if (agentIds.size > MAX_AGENT_METHODS) problems.push(`at most ${MAX_AGENT_METHODS} agent methods`);
  // Agent keys: Ed25519 Multikeys, each its own, none of the author's.
  const reserved = new Set([...updateKeys, byId.get(authorId)?.publicKeyMultibase, assertion?.publicKeyMultibase].filter((key): key is string => typeof key === "string"));
  const agentKeys = new Set<string>();
  for (const id of agentIds) {
    const vm = byId.get(id)!;
    if (vm.type !== "Multikey" || !isEd25519Multikey(vm.publicKeyMultibase)) {
      problems.push(`${id} is not an Ed25519 Multikey`);
      continue;
    }
    if (reserved.has(vm.publicKeyMultibase)) problems.push(`${id} reuses the author's key`);
    if (agentKeys.has(vm.publicKeyMultibase)) problems.push(`${id} reuses another agent method's key`);
    agentKeys.add(vm.publicKeyMultibase);
  }
  if (expect.authorKey && byId.get(authorId)?.publicKeyMultibase !== expect.authorKey) problems.push(`#${AUTHOR_VM_FRAGMENT} is not this account's author key`);
  if (assertionRefs.length !== 1) problems.push(`assertionMethod must be exactly #${ASSERTION_VM_FRAGMENT}`);
  // authentication: #key-0 first, then every agent method once, and nothing else.
  const authRefs = (doc.authentication ?? []).map(ref => absolute(did, typeof ref === "string" ? ref : ref.id ?? ""));
  const agentRefs = authRefs.slice(1);
  if (authRefs[0] !== authorId
    || new Set(agentRefs).size !== agentRefs.length
    || agentRefs.length !== agentIds.size
    || agentRefs.some(ref => !agentIds.has(ref))) {
    problems.push(`authentication must be exactly #${AUTHOR_VM_FRAGMENT} followed by each agent method`);
  }
  for (const relationship of ["capabilityInvocation", "capabilityDelegation", "keyAgreement"] as const) {
    if ((doc[relationship] ?? []).length > 0) problems.push(`${relationship} must be empty`);
  }
  return problems;
}

export class AgentMethodError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentMethodError";
  }
}

export type AgentMethodChange =
  | { add: { fragment: string; publicKeyMultibase: string } }
  | { remove: string };

/**
 * The DID document that follows `doc` once an agent method is added or
 * removed: the state the author key signs as the next did:webvh version
 * (pass `verificationMethod`, `authentication` and `assertionMethod` to
 * didwebvh-ts updateDID, with `updateKeys` unchanged). Pure; throws
 * AgentMethodError when the change, or the document it yields, is not an
 * author DID by `authorDidProblems`.
 */
export function nextAgentDocument<T extends DidDocumentLike>(doc: T, updateKeys: string[], change: AgentMethodChange): T {
  const did = doc.id;
  if (!did) throw new AgentMethodError("not a DID document");
  const methods = doc.verificationMethod ?? [];
  const authentication = doc.authentication ?? [];
  // Write ids the way the document already does (didwebvh-ts keeps `#key-0` relative).
  const authorVm = methods.find(vm => fragmentOf(did, vm.id ?? "") === AUTHOR_VM_FRAGMENT);
  const relative = authorVm?.id?.startsWith("#") ?? true;
  const idFor = (fragment: string) => (relative ? `#${fragment}` : `${did}#${fragment}`);
  let next: T;
  if ("add" in change) {
    const { fragment, publicKeyMultibase } = change.add;
    if (!isAgentFragment(fragment)) throw new AgentMethodError(`${fragment} is not an agent method fragment`);
    if (!isEd25519Multikey(publicKeyMultibase)) throw new AgentMethodError("the agent key is not an Ed25519 Multikey");
    if (methods.some(vm => fragmentOf(did, vm.id ?? "") === fragment)) throw new AgentMethodError(`#${fragment} is already a verification method`);
    if (methods.some(vm => vm.publicKeyMultibase === publicKeyMultibase) || updateKeys.includes(publicKeyMultibase)) {
      throw new AgentMethodError("the agent key is already in this DID");
    }
    next = {
      ...doc,
      verificationMethod: [...methods, { id: idFor(fragment), type: "Multikey", controller: did, publicKeyMultibase }],
      authentication: [...authentication, idFor(fragment)],
    };
  } else {
    const fragment = change.remove;
    if (!isAgentFragment(fragment)) throw new AgentMethodError(`${fragment} is not an agent method fragment`);
    if (!methods.some(vm => fragmentOf(did, vm.id ?? "") === fragment)) throw new AgentMethodError(`#${fragment} is not in this DID`);
    next = {
      ...doc,
      verificationMethod: methods.filter(vm => fragmentOf(did, vm.id ?? "") !== fragment),
      authentication: authentication.filter(ref => fragmentOf(did, typeof ref === "string" ? ref : ref.id ?? "") !== fragment),
    };
  }
  const problems = authorDidProblems(next, updateKeys);
  if (problems.length > 0) throw new AgentMethodError(`the next DID document is not an author DID: ${problems.join("; ")}`);
  return next;
}

interface LogEntryLike {
  versionId?: string;
  parameters?: Record<string, unknown>;
  state?: DidDocumentLike;
}

/**
 * Everything that keeps a whole log from being an author DID log: every
 * version, genesis included, must be an author DID with the same pinned keys.
 * A DID whose history ever had another key could have signed as the author.
 */
export function authorLogProblems(entries: LogEntryLike[], expect: { authorKey?: string; assertionKey?: string } = {}): string[] {
  let updateKeys: string[] = [];
  for (const [index, entry] of entries.entries()) {
    if (Array.isArray(entry.parameters?.updateKeys)) updateKeys = entry.parameters.updateKeys as string[];
    const problems = authorDidProblems(entry.state ?? {}, updateKeys, expect);
    if (problems.length > 0) return problems.map(problem => `version ${index + 1}: ${problem}`);
  }
  return [];
}
