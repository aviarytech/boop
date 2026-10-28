/**
 * Lists as Originals (Originals SDK 5).
 *
 * Each list is an Original: a did:vh asset log signed by its owner's
 * did:webvh. Entries are signed on the owner's device — boop never signs for
 * anyone — and saved through Convex as the shared host (convex/originalsHost.ts),
 * which appends only an entry that extends the accepted head and verifies.
 *
 * The device signer and its place in the owner's DID come from
 * `setListAuthorSource`, which the device-key work (#286) provides. Until a
 * source is set, nothing can be signed: lists still work, they just have no
 * Original yet, and `mintList` throws ListNotAuthorableError.
 *
 * Nothing written under CEL (did:cel) is read. A legacy list is re-minted from
 * its current state as a new Original; its old history is not carried over.
 */

import type { ConvexReactClient } from "convex/react";
import {
  EVIDENCE_FORMAT,
  MemoryStore,
  OriginalsSDK,
  type OriginalsSigner,
  type OriginalView,
  type SharedHost,
  type SubmitResult,
} from "@originals/sdk/originals";
import {
  ORIGINALS_METHOD,
  resourceDigest,
  type AuthorDidEvidence,
  type AuthorRef,
  type ValidAsOf,
} from "@originals/vh/originals";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";

/** The Convex calls the host needs, with the session already applied (useOriginalsClient). */
export type OriginalsClient = Pick<ConvexReactClient, "query" | "action">;

/** Who signs a list's entries on this device: the owner's DID, the device key's VM, and that DID's history. */
export interface ListAuthor {
  author: AuthorRef;
  signer: OriginalsSigner;
  evidence: AuthorDidEvidence;
}

let authorSource: () => Promise<ListAuthor | null> = async () => null;

/** Install where this device's signer comes from. Called once by the device-key setup. */
export function setListAuthorSource(source: () => Promise<ListAuthor | null>): void {
  authorSource = source;
}

/** This device's signer for `ownerDid`'s lists, or null when it cannot sign for them. */
export async function getListAuthor(ownerDid: string): Promise<ListAuthor | null> {
  const who = await authorSource();
  return who && who.author.did === ownerDid ? who : null;
}

/**
 * Thrown when this device cannot sign for a list: it is someone else's, or the
 * device has no key in the owner's DID yet. Nothing the user did is wrong.
 */
export class ListNotAuthorableError extends Error {
  constructor(message = "This device can't sign for this list yet.") {
    super(message);
    this.name = "ListNotAuthorableError";
  }
}

/** A list's published state, as committed to by the `list-metadata` resource. */
export interface ListSnapshot {
  name: string;
  items: Array<{ name: string; checked: boolean }>;
}

export function buildListSnapshot(
  name: string,
  items: Array<{ name: string; checked: boolean }>
): ListSnapshot {
  return { name, items: items.map(({ name, checked }) => ({ name, checked })) };
}

const LIST_RESOURCE = "list-metadata";
const NOTE_RESOURCE = "note-body";
const encoder = new TextEncoder();

function snapshotBytes(snapshot: ListSnapshot): Uint8Array {
  return encoder.encode(JSON.stringify(snapshot));
}

/** The Convex shared host for one list's Original. */
function convexHost(client: OriginalsClient, listId: Id<"lists">): SharedHost {
  return {
    async submit(submission) {
      return client.action(api.originalsHost.submitEntry, {
        listId,
        original: submission.original,
        entry: submission.entry,
        resources: Object.entries(submission.resources).map(([digest, bytes]) => ({
          digest,
          bytes: bytes.slice().buffer,
        })),
      });
    },
    async accepted(original) {
      const hosted = await client.query(api.originalsHost.getAccepted, { listId });
      if (!hosted || hosted.did !== original) throw new Error(`The host has no log for ${original}`);
      const obtainedAt = new Date().toISOString();
      return {
        manifest: {
          format: EVIDENCE_FORMAT,
          profile: ORIGINALS_METHOD,
          original,
          checkpoint: hosted.head,
          head: hosted.head,
          completeness: hosted.author ? "complete" : "partial",
          missing: hosted.author ? [] : [{ kind: "identity", did: "", role: "author" }],
        },
        log: hosted.log,
        authors: hosted.author ? [{ ...hosted.author, source: "host", obtainedAt }] : [],
        bytes: Object.fromEntries(hosted.resources.map((r) => [r.digest, new Uint8Array(r.bytes)])),
      };
    },
  };
}

function sdkFor(who: ListAuthor | null): OriginalsSDK {
  return OriginalsSDK.create({ store: new MemoryStore(), authors: who ? [who.evidence] : [] });
}

async function requireAuthor(ownerDid: string): Promise<ListAuthor> {
  const who = await getListAuthor(ownerDid);
  if (!who) throw new ListNotAuthorableError();
  return who;
}

export interface MintInput {
  listId: Id<"lists">;
  ownerDid: string;
  name: string;
  /** Lists commit to their items; notes to their markdown body. */
  content: { kind: "list"; snapshot: ListSnapshot } | { kind: "note"; body: string };
}

/**
 * Mint a list's Original from its current state: the genesis entry, signed on
 * this device and accepted by the host, which then names the list by it. Also
 * the re-mint for a legacy did:cel list — a new DID with no claim to the old
 * history. If another device minted first, its Original is kept.
 */
export async function mintList(client: OriginalsClient, input: MintInput): Promise<string> {
  const who = await requireAuthor(input.ownerDid);
  const sdk = sdkFor(who);
  const resources = input.content.kind === "list"
    ? [{ id: LIST_RESOURCE, mediaType: "application/json", bytes: snapshotBytes(input.content.snapshot) }]
    : [{ id: NOTE_RESOURCE, mediaType: "text/markdown", bytes: encoder.encode(input.content.body) }];
  const draft = await sdk.prepareCreate({
    name: input.name,
    metadata: { app: "boop", kind: input.content.kind },
    resources,
    author: who.author,
  });
  // Genesis has no parent to submit against, so it is committed locally (signed
  // and verified here) and that exact line is what the host judges.
  const { original } = await sdk.commit(draft, who.signer);
  const entry = (await sdk.committedLog(original.did)).trimEnd();
  const answer = await convexHost(client, input.listId).submit({
    original: original.did, entry, resources: Object.fromEntries(draft.bytes), identities: [],
  });
  if (answer.status === "stale-parent") {
    const hosted = await client.query(api.originalsHost.getAccepted, { listId: input.listId });
    if (!hosted) throw new Error("The list's Original could not be saved");
    return hosted.did;
  }
  return original.did;
}

export interface RecordedVersion {
  /** The checkpoint that commits to the published state. */
  checkpoint: string;
  /** The list-metadata resource's version; genesis is 1. */
  version: number;
  /** False when the published state matched the current version and nothing was appended. */
  appended: boolean;
}

/**
 * Append a signed snapshot of the list's published state to its Original, so
 * what was published is in the log that records the list's history. Stays on
 * did:vh: boop serves published lists at a stable path, not through an alias.
 */
export async function recordPublishedVersion(
  client: OriginalsClient,
  list: { listId: Id<"lists">; ownerDid: string; did: string },
  snapshot: ListSnapshot
): Promise<RecordedVersion> {
  const who = await requireAuthor(list.ownerDid);
  const sdk = sdkFor(who);
  const host = convexHost(client, list.listId);
  const head = (await sdk.sync(list.did, host)).original;

  const bytes = snapshotBytes(snapshot);
  const current = latestVersion(head, LIST_RESOURCE);
  if (current?.digest === resourceDigest(bytes)) {
    return { checkpoint: head.checkpoint, version: current.version, appended: false };
  }

  const change = { resources: [{ id: LIST_RESOURCE, bytes, mediaType: "application/json" }] };
  const draft = await sdk.prepareEdit(list.did, { ...change, parent: head.checkpoint, author: who.author });
  let saved: SubmitResult = await sdk.submit(await sdk.sign(draft, who.signer), host);
  if (saved.status === "stale-parent") {
    // Another device saved first. Publishing commits to the state being
    // published, not to a merge, so the same snapshot goes on the new head.
    saved = await sdk.reconcile(list.did, {
      host, refused: saved.refused.versionId, author: who.author, signer: who.signer, change: () => change,
    });
    if (saved.status === "stale-parent") throw new Error("The list changed on another device; publish again");
  }
  const published = latestVersion(saved.original, LIST_RESOURCE)!;
  return { checkpoint: saved.checkpoint, version: published.version, appended: true };
}

function latestVersion(view: OriginalView, resource: string) {
  return view.resources.filter((r) => r.resource === resource).at(-1);
}

export interface ListVerification {
  did: string;
  /**
   * Valid as of a checkpoint (history, author binding, identity evidence) and
   * every resource's bytes served and matching its signed digest. The host is
   * the only copy of the bytes, so missing content is a failure here.
   */
  verified: boolean;
  content: "available" | "partial" | "digest-failure";
  validAsOf: ValidAsOf | null;
  checkpoint: string;
  /** Why the result is not current. Always includes "not-anchored" for an Original not on Bitcoin. */
  reasons: string[];
  error?: string;
}

/**
 * Verify a list's Original from what the host serves, trusting none of it:
 * the log, the owner's DID history and the bytes are all checked here. Null
 * when the list has no Original yet. Fails closed.
 */
export async function verifyList(client: OriginalsClient, listId: Id<"lists">): Promise<ListVerification | null> {
  const hosted = await client.query(api.originalsHost.getAccepted, { listId });
  if (!hosted) return null;
  try {
    const { original } = await sdkFor(null).sync(hosted.did, convexHost(client, listId));
    const content = original.report.resources.status;
    return {
      did: original.did,
      verified: original.validAsOf !== null && content === "available",
      content,
      validAsOf: original.validAsOf,
      checkpoint: original.checkpoint,
      reasons: original.report.reasons,
      ...(content !== "available" ? { error: "Its content doesn't match its signed history" } : {}),
    };
  } catch (err) {
    return {
      did: hosted.did, verified: false, content: "partial", validAsOf: null, checkpoint: hosted.head, reasons: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** True for an asset DID minted before Originals 5, which must be re-minted. */
export function isLegacyAssetDid(assetDid: string | undefined): boolean {
  return !!assetDid && !assetDid.startsWith("did:vh:");
}
