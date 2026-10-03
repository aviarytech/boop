/**
 * Deferred provenance work.
 *
 * Turnkey is a remote signer, so signing cannot happen inside a mutation: with
 * no network there is no signature, and a grocery list in a shop is exactly
 * that case. Every item action commits to Convex immediately and lands here;
 * this queue signs it whenever a session is live.
 *
 * The consequence the UI has to respect is that provenance TRAILS state. An
 * action is real the moment it commits; it becomes provable later.
 *
 * Order is preserved per list, and a failure halts only that list's chain — an
 * `added` that has not landed must not be overtaken by its own `checked`.
 */

import type { VerifiableCredential } from "@originals/sdk";
import type { ItemAction } from "./credentials";
import type { RawEd25519Signer } from "./originalsSigner";
import { recordItemAction } from "./listLog";

/** Stop retrying after this many failures and surface the action instead. */
const MAX_ATTEMPTS = 5;

export interface PendingAction {
  id: number;
  /** Convex list id — identifies which log this belongs to. */
  listId: string;
  itemId: string;
  action: ItemAction;
  itemName?: string;
  actorDid: string;
  /** When the user acted, not when it was signed. */
  at: string;
  attempts: number;
  lastError?: string;
  /** Set once retries are exhausted; kept so the UI can surface it. */
  failed?: boolean;
}

/** Persistence for the queue itself. Injected so tests need no IndexedDB. */
export interface QueueStore {
  add(action: Omit<PendingAction, "id">): Promise<number>;
  /** Insertion order. */
  list(): Promise<PendingAction[]>;
  update(action: PendingAction): Promise<void>;
  remove(id: number): Promise<void>;
}

/** How the queue reaches the stored logs and claim store. */
export interface QueueTransport {
  loadLog(listId: string): Promise<string | null>;
  saveLog(listId: string, eventLog: string): Promise<void>;
  /** Claims against lists we do not control, awaiting the owner. */
  saveClaim(listId: string, credential: VerifiableCredential): Promise<void>;
}

export interface DrainResult {
  appended: number;
  claimed: number;
  /** Actions still queued — either retryable or permanently failed. */
  pending: number;
  failed: number;
}

export async function enqueue(
  store: QueueStore,
  action: Omit<PendingAction, "id" | "attempts">
): Promise<number> {
  return store.add({ ...action, attempts: 0 });
}

/**
 * Sign and apply everything queued.
 *
 * Batches per list: each action is a separate signature — unavoidable, every
 * event is signed — but the resulting log is written back once per list rather
 * than once per action.
 *
 * A null signer is not an error. It is the ordinary offline state, and the
 * queue simply stays put.
 */
export async function drainQueue(params: {
  store: QueueStore;
  transport: QueueTransport;
  signer: RawEd25519Signer | null;
}): Promise<DrainResult> {
  const result: DrainResult = { appended: 0, claimed: 0, pending: 0, failed: 0 };

  const queued = (await params.store.list()).filter((action) => !action.failed);
  if (!params.signer) {
    const all = await params.store.list();
    result.pending = all.length;
    result.failed = all.filter((a) => a.failed).length;
    return result;
  }

  // Group by list so each log is loaded and written once.
  const byList = new Map<string, PendingAction[]>();
  for (const action of queued) {
    const bucket = byList.get(action.listId) ?? [];
    bucket.push(action);
    byList.set(action.listId, bucket);
  }

  for (const [listId, actions] of byList) {
    let log: string | null;
    try {
      log = await params.transport.loadLog(listId);
    } catch (err) {
      await failBatch(params.store, actions, err);
      continue;
    }

    if (!log) {
      // The list has no asset yet — its genesis is itself queued work, or it
      // predates Turnkey custody. Leave the actions for a later drain.
      await failBatch(params.store, actions, new Error("List has no event log yet"));
      continue;
    }

    let dirty = false;

    for (const action of actions) {
      try {
        const outcome = await recordItemAction({
          storedLog: log,
          itemId: action.itemId,
          action: action.action,
          itemName: action.itemName,
          actorDid: action.actorDid,
          signer: params.signer,
          at: action.at,
        });

        if (outcome.kind === "appended") {
          log = outcome.eventLog;
          dirty = true;
          result.appended += 1;
        } else {
          await params.transport.saveClaim(listId, outcome.credential);
          result.claimed += 1;
        }

        await params.store.remove(action.id);
      } catch (err) {
        await recordFailure(params.store, action, err);
        // Halt this list: a later action must not overtake the one that failed.
        break;
      }
    }

    if (dirty && log) {
      try {
        await params.transport.saveLog(listId, log);
      } catch (err) {
        // The events were signed but could not be stored. They are already
        // dequeued, so re-queueing them would double-append on the next drain;
        // the log is simply lost and will be rebuilt from the next action.
        console.error(`[signingQueue] Could not persist log for ${listId}:`, err);
      }
    }
  }

  const remaining = await params.store.list();
  result.pending = remaining.length;
  result.failed = remaining.filter((a) => a.failed).length;
  return result;
}

async function recordFailure(
  store: QueueStore,
  action: PendingAction,
  err: unknown
): Promise<void> {
  const attempts = action.attempts + 1;
  await store.update({
    ...action,
    attempts,
    lastError: err instanceof Error ? err.message : String(err),
    failed: attempts >= MAX_ATTEMPTS,
  });
}

async function failBatch(
  store: QueueStore,
  actions: PendingAction[],
  err: unknown
): Promise<void> {
  for (const action of actions) {
    await recordFailure(store, action, err);
  }
}

/** Actions that will not be retried. Surface these rather than hiding them. */
export async function failedActions(store: QueueStore): Promise<PendingAction[]> {
  return (await store.list()).filter((action) => action.failed);
}

/** In-memory store — used by tests and as the fallback when IndexedDB is unavailable. */
export function createMemoryQueueStore(): QueueStore {
  const actions = new Map<number, PendingAction>();
  let nextId = 1;

  return {
    async add(action) {
      const id = nextId++;
      actions.set(id, { ...action, id });
      return id;
    },
    async list() {
      return [...actions.values()].sort((a, b) => a.id - b.id);
    },
    async update(action) {
      actions.set(action.id, action);
    },
    async remove(id) {
      actions.delete(id);
    },
  };
}
