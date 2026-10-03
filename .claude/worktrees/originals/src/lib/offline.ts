/**
 * IndexedDB setup for offline data storage (Phase 5.2)
 *
 * Uses the `idb` package for type-safe IndexedDB access.
 * Stores: lists, items, mutations (queue for offline mutations)
 */

import { openDB, type IDBPDatabase } from "idb";
import type { Id } from "../../convex/_generated/dataModel";

// ============================================================================
// Types mirroring Convex schema for offline storage
// ============================================================================

/** Offline-cached list data */
export interface OfflineList {
  _id: Id<"lists">;
  assetDid: string;
  name: string;
  ownerDid: string;
  categoryId?: Id<"categories">;
  createdAt: number;
  // Timestamp when cached locally
  _cachedAt: number;
}

/** Offline-cached item data */
export interface OfflineItem {
  _id: Id<"items">;
  listId: Id<"lists">;
  name: string;
  checked: boolean;
  createdByDid: string;
  checkedByDid?: string;
  createdAt: number;
  checkedAt?: number;
  order?: number;
  // Enhanced fields
  description?: string;
  dueDate?: number;
  url?: string;
  recurrence?: {
    frequency: "daily" | "weekly" | "monthly";
    interval?: number;
    nextDue?: number;
    endDate?: number;
  };
  assigneeDid?: string;
  // Timestamp when cached locally
  _cachedAt: number;
}

/** Mutation types supported offline */
export type MutationType = 
  | "addItem" 
  | "checkItem" 
  | "uncheckItem" 
  | "reorderItem"
  | "updateItem"
  | "removeItem"
  | "batchCheckItems"
  | "batchUncheckItems"
  | "batchDeleteItems"
  | "createList"
  | "renameList"
  | "deleteList";

/** A mutation queued for later sync */
export interface QueuedMutation {
  id?: number; // Auto-incremented by IndexedDB
  type: MutationType;
  payload: unknown;
  timestamp: number;
  retryCount: number;
}

// ============================================================================
// IndexedDB Schema Definition
// ============================================================================

/** Type-safe IndexedDB schema */
export interface OfflineDBSchema {
  lists: {
    key: string; // _id as string
    value: OfflineList;
  };
  items: {
    key: string; // _id as string
    value: OfflineItem;
    indexes: { byList: string }; // Index by listId
  };
  mutations: {
    key: number; // Auto-increment ID
    value: QueuedMutation;
  };
}

const DB_NAME = "lisa-offline";
const DB_VERSION = 1;

// Singleton promise to avoid multiple DB connections
let dbPromise: Promise<IDBPDatabase<OfflineDBSchema>> | null = null;

/**
 * Get the offline IndexedDB database instance.
 * Creates the database and stores if they don't exist.
 */
export async function getOfflineDB(): Promise<IDBPDatabase<OfflineDBSchema>> {
  if (!dbPromise) {
    dbPromise = openDB<OfflineDBSchema>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        // Lists store - keyed by _id
        if (!db.objectStoreNames.contains("lists")) {
          db.createObjectStore("lists", { keyPath: "_id" });
        }

        // Items store - keyed by _id with index for efficient list queries
        if (!db.objectStoreNames.contains("items")) {
          const itemsStore = db.createObjectStore("items", { keyPath: "_id" });
          itemsStore.createIndex("byList", "listId");
        }

        // Mutations queue - auto-increment ID for ordering
        if (!db.objectStoreNames.contains("mutations")) {
          db.createObjectStore("mutations", {
            keyPath: "id",
            autoIncrement: true,
          });
        }
      },
    });
  }
  return dbPromise;
}

// ============================================================================
// Mutation Queue CRUD Helpers
// ============================================================================

/**
 * Queue a mutation for later sync when back online.
 * @param mutation - The mutation to queue (id will be auto-assigned)
 * @returns The auto-generated mutation ID
 */
export async function queueMutation(
  mutation: Omit<QueuedMutation, "id">
): Promise<number> {
  const db = await getOfflineDB();
  const id = await db.add("mutations", mutation as QueuedMutation);
  return id as number;
}

/**
 * Get all queued mutations in order (oldest first).
 */
export async function getQueuedMutations(): Promise<QueuedMutation[]> {
  const db = await getOfflineDB();
  return db.getAll("mutations");
}

/**
 * Remove a mutation from the queue (after successful sync or max retries).
 * @param id - The mutation ID to remove
 */
export async function clearMutation(id: number): Promise<void> {
  const db = await getOfflineDB();
  await db.delete("mutations", id);
}

/**
 * Update the retry count for a failed mutation.
 * @param id - The mutation ID
 * @param retryCount - The new retry count
 */
export async function updateMutationRetry(
  id: number,
  retryCount: number
): Promise<void> {
  const db = await getOfflineDB();
  const mutation = await db.get("mutations", id);
  if (mutation) {
    mutation.retryCount = retryCount;
    await db.put("mutations", mutation);
  }
}

// ============================================================================
// List Cache Helpers (for future phases)
// ============================================================================

/**
 * Cache a list for offline access.
 */
export async function cacheList(list: Omit<OfflineList, "_cachedAt">): Promise<void> {
  const db = await getOfflineDB();
  await db.put("lists", { ...list, _cachedAt: Date.now() });
}

/**
 * Get a cached list by ID.
 */
export async function getCachedList(
  listId: Id<"lists">
): Promise<OfflineList | undefined> {
  const db = await getOfflineDB();
  return db.get("lists", listId);
}

/**
 * Get all cached lists.
 */
export async function getAllCachedLists(): Promise<OfflineList[]> {
  const db = await getOfflineDB();
  return db.getAll("lists");
}

/**
 * Cache multiple lists at once (more efficient than individual calls).
 */
export async function cacheAllLists(
  lists: Omit<OfflineList, "_cachedAt">[]
): Promise<void> {
  const db = await getOfflineDB();
  const tx = db.transaction("lists", "readwrite");
  const store = tx.objectStore("lists");
  const now = Date.now();
  await Promise.all([
    ...lists.map((list) => store.put({ ...list, _cachedAt: now })),
    tx.done,
  ]);
}

/**
 * Remove a list from the cache.
 */
export async function removeCachedList(listId: Id<"lists">): Promise<void> {
  const db = await getOfflineDB();
  await db.delete("lists", listId);
}

// ============================================================================
// Item Cache Helpers (for future phases)
// ============================================================================

/**
 * Cache an item for offline access.
 */
export async function cacheItem(item: Omit<OfflineItem, "_cachedAt">): Promise<void> {
  const db = await getOfflineDB();
  await db.put("items", { ...item, _cachedAt: Date.now() });
}

/**
 * Get a cached item by ID.
 */
export async function getCachedItem(
  itemId: Id<"items">
): Promise<OfflineItem | undefined> {
  const db = await getOfflineDB();
  return db.get("items", itemId);
}

/**
 * Get all cached items for a specific list.
 */
export async function getCachedItemsByList(
  listId: Id<"lists">
): Promise<OfflineItem[]> {
  const db = await getOfflineDB();
  return db.getAllFromIndex("items", "byList", listId);
}

/**
 * Cache multiple items at once (more efficient than individual calls).
 */
export async function cacheItems(
  items: Omit<OfflineItem, "_cachedAt">[]
): Promise<void> {
  const db = await getOfflineDB();
  const tx = db.transaction("items", "readwrite");
  const store = tx.objectStore("items");
  const now = Date.now();
  await Promise.all([
    ...items.map((item) => store.put({ ...item, _cachedAt: now })),
    tx.done,
  ]);
}

/**
 * Remove an item from the cache.
 */
export async function removeCachedItem(itemId: Id<"items">): Promise<void> {
  const db = await getOfflineDB();
  await db.delete("items", itemId);
}

/**
 * Remove all items for a list from the cache.
 */
export async function removeCachedItemsByList(listId: Id<"lists">): Promise<void> {
  const db = await getOfflineDB();
  const tx = db.transaction("items", "readwrite");
  const store = tx.objectStore("items");
  const index = store.index("byList");

  let cursor = await index.openCursor(listId);
  while (cursor) {
    await cursor.delete();
    cursor = await cursor.continue();
  }

  await tx.done;
}
