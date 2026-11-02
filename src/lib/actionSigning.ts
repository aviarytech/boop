/**
 * Signing action records on the author's device (#237, #286).
 *
 * For each action a mutation will record, this builds the version-2 payload
 * from the arguments about to be sent (shared/actionRecord.ts
 * clientActionChanges) and signs its signing input with the author's Turnkey
 * assertion key, `#orig-1` of their did:webvh, through this device's Turnkey
 * session. The server rebuilds the same bytes from the same arguments and only
 * stores the signature if it verifies over them, so nothing here can make the
 * author sign something other than what the mutation does.
 *
 * Signing is online-only and best-effort: no confirmed author DID, no live
 * session, an unclean sub-org audit or a Turnkey failure all mean the action is
 * recorded unsigned, never that it fails. It is also bounded: the whole step
 * (session check and every signature) gets SIGNING_BUDGET_MS, after which the
 * write goes out unsigned rather than waiting on Turnkey. Routine actions are signed without a
 * prompt, unlike Originals entries.
 */
import { verifyAsync } from "@noble/ed25519";
import { withTimeout } from "./authTimeout";
import { ASSERTION_VM_FRAGMENT } from "../../shared/authorDid";
import {
  actionRecordSigningInput,
  actionSubjectKey,
  buildActionRecord,
  clientActionChanges,
  encodeSignature,
  type ActionChange,
  type ActionSignatureEnvelope,
} from "../../shared/actionRecord";
import type { AuthorKeyBackend } from "./authorDid";
import { currentAuthor, type CurrentAuthor } from "./authorIdentity";
import { authorSigningReady, turnkeyAuthorBackend } from "./turnkeySession";

export interface ActionSigningDeps {
  author(): CurrentAuthor | null;
  ready(subOrgId: string): Promise<boolean>;
  backend: AuthorKeyBackend;
  now(): number;
  /** Test hook; production uses SIGNING_BUDGET_MS. */
  budgetMs?: number;
}

/** Turnkey calls in flight at once for one batch. */
const CONCURRENCY = 4;
/** A write never waits longer than this for its signatures (session lock and audit can take up to 60 s). */
export const SIGNING_BUDGET_MS = 5_000;

async function mapBounded<T, R>(items: T[], fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  }));
  return results;
}

/**
 * The envelope for `mutation` called with `args`, or undefined when this
 * device cannot sign as the author right now.
 */
export async function signActions(
  mutation: string,
  args: Record<string, unknown>,
  deps: ActionSigningDeps = defaultDeps(),
): Promise<ActionSignatureEnvelope | undefined> {
  const changes = clientActionChanges(mutation, args);
  if (changes.length === 0) return undefined;
  const author = deps.author();
  if (!author) return undefined;
  try {
    return await withTimeout(signNow(changes, author, deps), deps.budgetMs ?? SIGNING_BUDGET_MS, "Signing action records timed out");
  } catch (err) {
    console.warn("[actionSigning] Recording unsigned; signing failed:", err);
    return undefined;
  }
}

async function signNow(changes: ActionChange[], author: CurrentAuthor, deps: ActionSigningDeps): Promise<ActionSignatureEnvelope | undefined> {
  if (!(await deps.ready(author.subOrgId))) return undefined;
  const verificationMethod = `${author.did}#${ASSERTION_VM_FRAGMENT}`;
  const signedAt = deps.now();
  const key = author.keys.assertion;
  const signatures = await mapBounded(changes, async change => {
    const { payload } = buildActionRecord(change, { did: author.did, verificationMethod, versionId: author.versionId }, signedAt);
    const message = actionRecordSigningInput(payload);
    const signature = await deps.backend.sign(author.subOrgId, key.address, message);
    // Refuse a signature that is not this key's over these bytes, as every Turnkey signature is checked.
    if (signature.length !== 64 || !(await verifyAsync(signature, message, key.publicKey))) {
      throw new Error("Turnkey returned a signature that does not verify for the assertion key");
    }
    return { subject: actionSubjectKey(change), signature: encodeSignature(signature) };
  });
  return { verificationMethod, versionId: author.versionId, signedAt, signatures };
}

function defaultDeps(): ActionSigningDeps {
  return { author: currentAuthor, ready: authorSigningReady, backend: turnkeyAuthorBackend(), now: () => Date.now() };
}
