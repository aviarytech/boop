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
}

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
  const byId = new Map(methods.map(vm => [absolute(did, vm.id ?? ""), vm]));
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
  return problems;
}
