/**
 * Wiring for the signing queue: where pending work is kept, and how it reaches
 * Convex. Both are adapters so signingQueue.ts stays testable without either.
 */

import { openDB, type IDBPDatabase } from "idb";
import type { VerifiableCredential } from "@originals/sdk";
import type { PendingAction, QueueStore, QueueTransport } from "./signingQueue";

const DB_NAME = "boop-signing-queue";
const DB_VERSION = 1;
const STORE = "actions";

interface SigningQueueSchema {
  actions: {
    key: number;
    value: PendingAction;
  };
}

let dbPromise: Promise<IDBPDatabase<SigningQueueSchema>> | null = null;

function getDB(): Promise<IDBPDatabase<SigningQueueSchema>> {
  if (!dbPromise) {
    dbPromise = openDB<SigningQueueSchema>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE)) {
          // autoIncrement, so ids order by insertion — the queue's ordering
          // guarantee rides on that.
          db.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
        }
      },
    });
  }
  return dbPromise;
}

/**
 * Its own database, not `lisa-offline`. That one queues Convex mutations —
 * work the server will accept from anyone — while this queues signatures only
 * this device's session can make. Different lifetimes, different failure
 * modes, and bumping one schema should not risk the other.
 */
export function createIdbQueueStore(): QueueStore {
  return {
    async add(action) {
      const db = await getDB();
      // The keyPath is auto-assigned; `id` must be absent for that to happen.
      // The store is autoIncrement, so the key is always a number.
      return (await db.add(STORE, action as PendingAction)) as number;
    },
    async list() {
      const db = await getDB();
      return db.getAll(STORE);
    },
    async update(action) {
      const db = await getDB();
      await db.put(STORE, action);
    },
    async remove(id) {
      const db = await getDB();
      await db.delete(STORE, id);
    },
  };
}

/** The slice of a Convex client the transport needs. */
export interface ConvexLike {
  query(reference: unknown, args: Record<string, unknown>): Promise<unknown>;
  mutation(reference: unknown, args: Record<string, unknown>): Promise<unknown>;
}

export interface TransportRefs {
  getListEnvelope: unknown;
  saveListLog: unknown;
  submitClaim: unknown;
}

/**
 * Reaches Convex for the stored log and the pending-claim table.
 *
 * `listId` is the Convex row id — the queue is keyed by it rather than by
 * did:cel because an action can be queued before its list's genesis has landed.
 */
export function createConvexTransport(params: {
  convex: ConvexLike;
  refs: TransportRefs;
  userDid: string;
  legacyDid?: string;
}): QueueTransport {
  const { convex, refs, userDid, legacyDid } = params;

  return {
    async loadLog(listId) {
      const stored = (await convex.query(refs.getListEnvelope, {
        listId,
      })) as { envelope?: string } | null;
      return stored?.envelope ?? null;
    },

    async saveLog(listId, eventLog) {
      await convex.mutation(refs.saveListLog, {
        listId,
        eventLog,
        userDid,
        legacyDid,
      });
    },

    async saveClaim(listId, credential: VerifiableCredential) {
      const subject = credential.credentialSubject as {
        itemId?: string;
        action?: string;
      };

      await convex.mutation(refs.submitClaim, {
        listId,
        itemId: subject?.itemId ?? "",
        action: subject?.action ?? "",
        issuerDid: userDid,
        credential: JSON.stringify(credential),
        legacyDid,
      });
    },
  };
}
