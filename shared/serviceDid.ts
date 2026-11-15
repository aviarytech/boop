/**
 * The shape of the Boop service did:webvh (#286 P3, plans/002 D11): the
 * identity that countersigns receipts for accepted action records
 * (shared/receipt.ts).
 *
 * Two Ed25519 keys in one wallet of the Turnkey PARENT org, which the parent
 * can sign with server-side (it cannot sign in a user's sub-org):
 * - the update key is the DID's only update key and signs DID log entries,
 *   nothing else. Only the owner's script uses it (scripts/boop-service-did.ts);
 * - the receipt key (`#receipt-<n>`) is the DID's only verification method and
 *   only `assertionMethod`, and signs receipts. Convex signs with it.
 * A rotation replaces the receipt key with `#receipt-<n+1>` in a new version;
 * receipts name the version they were signed under, so earlier ones keep
 * verifying from the later log.
 */
import { parseEd25519PublicKey, type DidLogInput } from "./actionRecord";
import type { DidDocumentLike } from "./authorDid";

/** did:webvh:<scid>:<domain>:boop-service, served at https://<domain>/boop-service/did.jsonl. */
export const SERVICE_DID_PATH = "boop-service";
export const RECEIPT_VM_PREFIX = "receipt-";

/** BIP32 paths in the service wallet: the update key, then receipt key number n (from 1). */
export const SERVICE_UPDATE_KEY_PATH = "m/44'/501'/0'/0'";
export const receiptKeyPath = (n: number) => `m/44'/501'/${n}'/0'`;

const RECEIPT_FRAGMENT = /^receipt-([1-9][0-9]{0,8})$/;

/** The n of `#receipt-<n>`, or null. */
export function receiptKeyNumber(fragment: string): number | null {
  const match = RECEIPT_FRAGMENT.exec(fragment);
  return match ? Number(match[1]) : null;
}

const absolute = (did: string, ref: string) => (ref.startsWith("#") ? `${did}${ref}` : ref);

/** Everything that keeps this document from being a service DID version, empty when it is one. */
export function serviceDidProblems(doc: DidDocumentLike, updateKeys: string[]): string[] {
  const did = doc.id;
  if (!did || !did.startsWith("did:webvh:")) return ["not a did:webvh document"];
  const problems: string[] = [];
  if (!did.endsWith(`:${SERVICE_DID_PATH}`)) problems.push(`the DID is not served at /${SERVICE_DID_PATH}`);

  const methods = doc.verificationMethod ?? [];
  const method = methods[0];
  const id = absolute(did, method?.id ?? "");
  if (methods.length !== 1 || !id.startsWith(`${did}#`) || receiptKeyNumber(id.slice(did.length + 1)) === null) {
    problems.push(`verification methods must be exactly one #${RECEIPT_VM_PREFIX}<n>`);
  }
  if (method) {
    if (method.controller !== did) problems.push("the receipt key is not controlled by the DID");
    if (method.type !== "Multikey" || typeof method.publicKeyMultibase !== "string"
      || !method.publicKeyMultibase.startsWith("z") || parseEd25519PublicKey(method.publicKeyMultibase) === null) {
      problems.push("the receipt key is not an Ed25519 Multikey");
    }
    // The key Convex can sign with must never be able to change the DID.
    if (method.publicKeyMultibase && updateKeys.includes(method.publicKeyMultibase)) problems.push("the receipt key is also an update key");
  }
  const refs = doc.assertionMethod ?? [];
  if (refs.length !== 1 || typeof refs[0] !== "string" || absolute(did, refs[0]) !== id) {
    problems.push("assertionMethod must be exactly the receipt key, by reference");
  }
  for (const relationship of ["authentication", "capabilityInvocation", "capabilityDelegation", "keyAgreement"] as const) {
    if ((doc[relationship] ?? []).length > 0) problems.push(`${relationship} must be empty`);
  }
  if (updateKeys.length !== 1) problems.push("a service DID has exactly one update key");
  return problems;
}

type LogEntryLike = { versionId?: unknown; parameters?: { updateKeys?: unknown }; state?: DidDocumentLike };

function entriesOf(log: DidLogInput): LogEntryLike[] | null {
  if (typeof log !== "string") return log as LogEntryLike[];
  try {
    return log.split("\n").filter(line => line.trim().length > 0).map(line => JSON.parse(line) as LogEntryLike);
  } catch {
    return null;
  }
}

/**
 * Everything that keeps a whole log from being a service DID log: every
 * version a service DID, one DID throughout, and receipt key numbers that
 * only go up (a number, once replaced, never names another key).
 */
export function serviceLogProblems(log: DidLogInput): string[] {
  const entries = entriesOf(log);
  if (!entries || entries.length === 0) return ["the log is empty or not JSON Lines"];
  let updateKeys: string[] = [];
  let previous: { number: number; key: string } | null = null;
  const did = entries[0].state?.id;
  for (const [index, entry] of entries.entries()) {
    const at = (problem: string) => `version ${index + 1}: ${problem}`;
    if (Array.isArray(entry.parameters?.updateKeys)) updateKeys = entry.parameters.updateKeys as string[];
    const problems = serviceDidProblems(entry.state ?? {}, updateKeys);
    if (problems.length > 0) return problems.map(at);
    if (entry.state!.id !== did) return [at("names another DID")];
    const method = entry.state!.verificationMethod![0];
    const number = receiptKeyNumber(absolute(did!, method.id!).slice(did!.length + 1))!;
    const key = method.publicKeyMultibase!;
    if (previous && (number < previous.number || (number === previous.number) !== (key === previous.key))) {
      return [at("a new receipt key must take the next unused number, and a number keeps its key")];
    }
    previous = { number, key };
  }
  return [];
}

export type ServiceReceiptKey = {
  did: string;
  /** The latest version of the log, which a new receipt names. */
  versionId: string;
  /** `<did>#receipt-<n>` */
  verificationMethod: string;
  publicKeyMultibase: string;
  number: number;
};

/** The key new receipts are signed with: the receipt key of the log's latest version. */
export function currentReceiptKey(log: DidLogInput): ServiceReceiptKey | { problems: string[] } {
  const problems = serviceLogProblems(log);
  if (problems.length > 0) return { problems };
  const entries = entriesOf(log)!;
  const head = entries[entries.length - 1];
  if (typeof head.versionId !== "string") return { problems: ["the latest version has no versionId"] };
  const did = head.state!.id!;
  const method = head.state!.verificationMethod![0];
  const verificationMethod = absolute(did, method.id!);
  return {
    did, versionId: head.versionId, verificationMethod, publicKeyMultibase: method.publicKeyMultibase!,
    number: receiptKeyNumber(verificationMethod.slice(did.length + 1))!,
  };
}
