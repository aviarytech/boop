/**
 * How the Convex shared host judges one submitted entry (P6.4, P6.7).
 *
 * Pure: given the accepted log and the author's DID history, it either answers
 * (an acknowledged retry, a stale parent) or returns the log to commit. The
 * action commits that conditional on the head it judged against, so a race is
 * a stale-parent conflict, never a fork. Kept out of the action so the rules
 * are testable without a deployment.
 */

import { vhHash } from "@originals/vh/log";
import { resourceDigest, verifyOriginal, type AuthorDidEvidence } from "@originals/vh/originals";

export type HostAnswer =
  | { status: "accepted" | "already-accepted"; checkpoint: string; head: string }
  | { status: "stale-parent"; head: string };

export interface HostedState {
  ownerDid: string;
  original: { did: string; log: string; head: string } | null;
  /** The owner's did:webvh log, as boop serves it. */
  authorLog: string | null;
}

export interface Submission {
  original: string;
  /** The signed entry: one compact JSON line, no newline. */
  entry: string;
  resources: Array<{ digest: string; bytes: ArrayBuffer }>;
}

export type Judgement =
  | { answer: HostAnswer }
  | { commit: { log: string; head: string; expectedHead: string | null } };

const VERSION_ID = /^(\d+)-(.+)$/;

function lines(log: string): string[] {
  return log.split("\n").filter((line) => line.length > 0);
}

/** True when `entry` is the next version after `head` and chains to it. */
function extendsHead(entry: Record<string, unknown> & { versionId: string }, head: string): boolean {
  const id = VERSION_ID.exec(entry.versionId);
  const h = VERSION_ID.exec(head);
  if (!id || !h || Number(id[1]) !== Number(h[1]) + 1) return false;
  const unsigned: Record<string, unknown> = { ...entry, versionId: head };
  delete unsigned.proof;
  try {
    return vhHash(unsigned as never) === id[2];
  } catch {
    return false;
  }
}

function stateOf(entry: Record<string, unknown>): { id?: unknown; author?: { did?: unknown } } {
  const state = entry.state;
  return typeof state === "object" && state !== null ? (state as never) : {};
}

export async function judgeSubmission(state: HostedState, submission: Submission, now: number): Promise<Judgement> {
  if (submission.entry.includes("\n")) throw new Error("An entry is one line");
  const parsed = JSON.parse(submission.entry) as Record<string, unknown> & { versionId: string };
  if (typeof parsed.versionId !== "string") throw new Error("Entry has no versionId");
  const entryState = stateOf(parsed);
  if (entryState.id !== submission.original) throw new Error("Entry is for another Original");
  // Lists have no editor grants yet, so the owner is the only valid signer.
  if (entryState.author?.did !== state.ownerDid) throw new Error("Only the list owner can author its Original");

  const current = state.original;
  if (current && current.did === submission.original) {
    // A byte-identical retry is acknowledged, even after the head moved (P6.4).
    if (lines(current.log).includes(submission.entry)) {
      return { answer: { status: "already-accepted", checkpoint: parsed.versionId, head: current.head } };
    }
    // Only an entry on the accepted head is judged further (P6.7).
    if (!extendsHead(parsed, current.head)) return { answer: { status: "stale-parent", head: current.head } };
  } else if (current) {
    // A second genesis for a list that already has its Original: the first stands.
    return { answer: { status: "stale-parent", head: current.head } };
  } else if (!/^1-/.test(parsed.versionId)) {
    throw new Error("The first entry of an Original is its genesis");
  }

  if (!state.authorLog) throw new Error("The author's DID history is not hosted here");
  const authors: AuthorDidEvidence[] = [{
    did: state.ownerDid, log: state.authorLog, source: "host", obtainedAt: new Date(now).toISOString(),
  }];

  const supplied = new Map<string, Uint8Array>();
  for (const r of submission.resources) {
    const bytes = new Uint8Array(r.bytes);
    if (resourceDigest(bytes) !== r.digest) throw new Error(`Resource bytes do not match ${r.digest}`);
    supplied.set(r.digest, bytes);
  }

  const prior = current ? lines(current.log) : [];
  const log = `${[...prior, submission.entry].join("\n")}\n`;
  const report = await verifyOriginal({ log, authors, bytes: Object.fromEntries(supplied), now });
  // Bytes the entry introduces must arrive with it, unless an earlier entry
  // already brought the same digest (a resource set back to an older state).
  const introduced = report.resources.versions.filter((rv) => rv.versionId === parsed.versionId);
  const bytesOk = introduced.every((rv) =>
    rv.bytes === "verified" || (rv.bytes === "missing" && prior.some((line) => line.includes(rv.digest))));
  const ok =
    report.history.status === "valid" && report.history.entries === prior.length + 1 &&
    report.authorBinding.status === "valid" && report.identityEvidence.status === "complete" &&
    report.head === parsed.versionId && bytesOk;
  if (!ok) {
    throw new Error(`Entry does not verify: ${report.reasons.join(", ") || report.history.status}`);
  }
  // Never accept an entry that is historically authorized only (P7.9).
  if (report.historicallyAuthorizedOnly.some((h) => h.versionId === parsed.versionId)) {
    throw new Error("Entry is signed by a key the author's DID no longer lists");
  }

  return {
    commit: {
      log,
      head: parsed.versionId,
      expectedHead: current?.did === submission.original ? current.head : null,
    },
  };
}
