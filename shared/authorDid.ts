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
 */

/** BIP32 paths of the two Ed25519 accounts in the sub-org's default wallet. */
export const AUTHOR_KEY_PATH = "m/44'/501'/0'/0'";
export const ASSERTION_KEY_PATH = "m/44'/501'/1'/0'";

export const AUTHOR_VM_FRAGMENT = "key-0";
export const ASSERTION_VM_FRAGMENT = "orig-1";

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

  // Exactly the two keys, each in its one relationship: no other key anyone
  // could sign with as this author (#300 review).
  const authorId = `${did}#${AUTHOR_VM_FRAGMENT}`;
  const ids = [...byId.keys()].sort();
  if (ids.length !== 2 || ids[0] !== authorId || ids[1] !== assertionId) {
    problems.push(`verification methods must be exactly #${AUTHOR_VM_FRAGMENT} and #${ASSERTION_VM_FRAGMENT}`);
  }
  if (expect.authorKey && byId.get(authorId)?.publicKeyMultibase !== expect.authorKey) problems.push(`#${AUTHOR_VM_FRAGMENT} is not this account's author key`);
  if (assertionRefs.length !== 1) problems.push(`assertionMethod must be exactly #${ASSERTION_VM_FRAGMENT}`);
  const authRefs = (doc.authentication ?? []).map(ref => absolute(did, typeof ref === "string" ? ref : ref.id ?? ""));
  if (authRefs.length !== 1 || authRefs[0] !== authorId) problems.push(`authentication must be exactly #${AUTHOR_VM_FRAGMENT}`);
  for (const relationship of ["capabilityInvocation", "capabilityDelegation", "keyAgreement"] as const) {
    if ((doc[relationship] ?? []).length > 0) problems.push(`${relationship} must be empty`);
  }
  return problems;
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
