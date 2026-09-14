import { authErrorData } from "../../convex/lib/authError";
import { storageAdapter } from "./storageAdapter";
/**
 * Sync Manager for offline mutation synchronization (Phase 5.3)
 *
 * Processes queued mutations when the user comes back online.
 * Uses exponential backoff for retries and notifies listeners of status changes.
 *
 * Phase 5.8 adds conflict detection: checks server state before applying
 * check/uncheck mutations and notifies users of conflicts via toast.
 */

import type { ConvexReactClient } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import {
  getQueuedMutations,
  clearMutation,
  updateMutationRetry,
  type QueuedMutation,
} from "./offline";
import { showGlobalToast } from "./toast";

// ============================================================================
// Constants
// ============================================================================

const MAX_RETRIES = 5;
const RETRY_DELAYS = [1000, 2000, 4000, 8000, 16000]; // Exponential backoff in ms

// ============================================================================
// Types
// ============================================================================

/** Possible sync status states */
export type SyncStatusType = "idle" | "syncing" | "synced" | "error";

/** Sync status with optional message for errors */
export interface SyncStatus {
  status: SyncStatusType;
  message?: string;
}

/** Result of conflict check before executing a mutation */
interface ConflictCheckResult {
  hasConflict: boolean;
  reason?: string;
}

// ============================================================================
// Mutation Payload Types (matching Convex mutation args)
// ============================================================================

interface AddItemPayload {
  listId: Id<"lists">;
  name: string;
  createdByDid: string;
  legacyDid?: string;
  createdAt: number;
}

interface CheckItemPayload {
  itemId: Id<"items">;
  checkedByDid: string;
  legacyDid?: string;
  checkedAt: number;
}

interface UncheckItemPayload {
  itemId: Id<"items">;
  userDid: string;
  legacyDid?: string;
}

interface ReorderItemPayload {
  listId: Id<"lists">;
  itemIds: Id<"items">[];
  userDid: string;
  legacyDid?: string;
}

interface UpdateItemPayload {
  itemId: Id<"items">;
  userDid: string;
  legacyDid?: string;
  name?: string;
  description?: string;
  dueDate?: number;
  url?: string;
  recurrence?: {
    frequency: "daily" | "weekly" | "monthly";
    interval?: number;
    nextDue?: number;
  };
  priority?: "high" | "medium" | "low";
  groceryAisle?: string;
  clearGroceryAisle?: boolean;
  clearDueDate?: boolean;
  clearRecurrence?: boolean;
  clearUrl?: boolean;
  clearPriority?: boolean;
}

interface RemoveItemPayload {
  itemId: Id<"items">;
  userDid: string;
  legacyDid?: string;
}

interface BatchCheckItemsPayload {
  itemIds: Id<"items">[];
  checkedByDid: string;
  legacyDid?: string;
}

interface BatchUncheckItemsPayload {
  itemIds: Id<"items">[];
  userDid: string;
  legacyDid?: string;
}

interface BatchDeleteItemsPayload {
  itemIds: Id<"items">[];
  userDid: string;
  legacyDid?: string;
}

interface CreateListPayload {
  assetDid: string;
  name: string;
  ownerDid: string;
  categoryId?: Id<"categories">;
  createdAt: number;
}

interface RenameListPayload {
  listId: Id<"lists">;
  name: string;
  userDid: string;
  legacyDid?: string;
}

interface DeleteListPayload {
  listId: Id<"lists">;
  userDid: string;
  legacyDid?: string;
}

function accessFailure(error: unknown): boolean {
  const data = authErrorData(error);
  if (data) return data.code !== "FORBIDDEN";
  // Compatibility with errors from a pre-cutover backend that has no RPC data.
  const message = error instanceof Error ? error.message : "";
  return /Authentication required|Invalid or expired token|Invalid API key|User not found|Token has expired|Identity assertion/i.test(message);
}

// ============================================================================
// SyncManager Class
// ============================================================================

/**
 * Manages synchronization of queued offline mutations with the server.
 *
 * Usage:
 * ```typescript
 * import { syncManager } from './sync';
 *
 * // Subscribe to status updates
 * const unsubscribe = syncManager.subscribe((status) => {
 *   console.log('Sync status:', status);
 * });
 *
 * // Trigger sync when back online
 * await syncManager.sync(convexClient);
 *
 * // Cleanup
 * unsubscribe();
 * ```
 */
export class SyncManager {
  private isSyncing = false;
  private listeners: Set<(status: SyncStatus) => void> = new Set();

  /**
   * Process all queued mutations in order.
   * Mutations are processed sequentially to preserve order.
   *
   * @param convex - The Convex React client for executing mutations
   */
  async sync(convex: ConvexReactClient): Promise<void> {
    // Prevent concurrent sync attempts
    if (this.isSyncing) {
      return;
    }

    this.isSyncing = true;
    this.notify({ status: "syncing" });

    try {
      const mutations = await getQueuedMutations();

      let failureMessage: string | undefined;
      for (const mutation of mutations) {
        try {
          // Phase 5.8: Check for conflicts before executing check/uncheck mutations
          const conflictCheck = await this.checkForConflict(convex, mutation);
          if (conflictCheck.hasConflict) {
            // Conflict detected - discard local change and notify user
            await clearMutation(mutation.id!);
            showGlobalToast(conflictCheck.reason || "Conflict detected", "warning");
            continue;
          }

          await this.executeMutation(convex, mutation);
          // Success - remove from queue
          await clearMutation(mutation.id!);
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : "Unknown error";

          if (accessFailure(error)) {
            // Preserve the entire remaining queue and its retry budget until access returns.
            const message = "Sync paused. Sign in with the account that made these edits; your changes are still saved.";
            this.notify({ status: "error", message });
            showGlobalToast(message, "warning");
            return;
          }

          if (authErrorData(error)?.code === "FORBIDDEN") {
            // A resource denial must not block unrelated edits or prompt a new login.
            if (mutation.retryCount >= MAX_RETRIES) {
              await clearMutation(mutation.id!);
              failureMessage = "An offline edit was discarded because its resource may have been removed or access is unavailable.";
            } else {
              await updateMutationRetry(mutation.id!, mutation.retryCount + 1);
              failureMessage = "Some offline edits could not sync because their resources may have been removed or access is unavailable. Other edits can still sync.";
              const delay = RETRY_DELAYS[mutation.retryCount] ?? 16000;
              await this.delay(delay);
            }
            showGlobalToast(failureMessage, "warning");
            continue;
          }

          if (mutation.retryCount >= MAX_RETRIES) {
            // Max retries reached - discard mutation and notify
            await clearMutation(mutation.id!);
            failureMessage = `Failed to sync ${mutation.type}: ${errorMessage}`;
          } else {
            // Increment retry count for next attempt
            await updateMutationRetry(mutation.id!, mutation.retryCount + 1);

            failureMessage = "Some offline edits could not sync. Please try again.";
            // Wait before continuing to next mutation
            const delay = RETRY_DELAYS[mutation.retryCount] ?? 16000;
            await this.delay(delay);
          }
        }
      }

      this.notify(failureMessage ? { status: "error", message: failureMessage } : { status: "synced" });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      this.notify({
        status: "error",
        message: `Sync failed: ${errorMessage}`,
      });
    } finally {
      this.isSyncing = false;
    }
  }

  /**
   * Check for conflicts before executing a mutation.
   * Applies to check/uncheck/update operations on items.
   *
   * Strategy: If server item's updatedAt > mutation's timestamp, there's a conflict.
   */
  private async checkForConflict(
    convex: ConvexReactClient,
    mutation: QueuedMutation
  ): Promise<ConflictCheckResult> {
    // Only check conflicts for item mutations that modify state
    if (
      mutation.type !== "checkItem" && 
      mutation.type !== "uncheckItem" &&
      mutation.type !== "updateItem"
    ) {
      return { hasConflict: false };
    }

    const payload = mutation.payload as CheckItemPayload | UncheckItemPayload | UpdateItemPayload;
    const itemId = payload.itemId;

    try {
      const serverItem = await convex.query(api.items.getItemForSync, { itemId, authToken: await storageAdapter.get("lisa-jwt-token") ?? undefined });

      // Check if server has newer data
      if (serverItem.updatedAt && serverItem.updatedAt > mutation.timestamp) {
        return {
          hasConflict: true,
          reason: "Item was updated by another user",
        };
      }

      return { hasConflict: false };
    } catch (error) {
      if (accessFailure(error) || authErrorData(error)?.code === "FORBIDDEN") throw error;
      // If we can't check, allow the mutation to proceed
      // The actual mutation will fail if there's an issue
      return { hasConflict: false };
    }
  }

  /**
   * Execute a single mutation against the Convex backend.
   */
  private async executeMutation(
    convex: ConvexReactClient,
    mutation: QueuedMutation
  ): Promise<void> {
    switch (mutation.type) {
      case "addItem": {
        const payload = mutation.payload as AddItemPayload;
        await convex.mutation(api.items.addItem, { ...payload, authToken: await storageAdapter.get("lisa-jwt-token") ?? undefined });
        break;
      }

      case "checkItem": {
        const payload = mutation.payload as CheckItemPayload;
        await convex.mutation(api.items.checkItem, { ...payload, authToken: await storageAdapter.get("lisa-jwt-token") ?? undefined });
        break;
      }

      case "uncheckItem": {
        const payload = mutation.payload as UncheckItemPayload;
        await convex.mutation(api.items.uncheckItem, { ...payload, authToken: await storageAdapter.get("lisa-jwt-token") ?? undefined });
        break;
      }

      case "reorderItem": {
        const payload = mutation.payload as ReorderItemPayload;
        await convex.mutation(api.items.reorderItems, { ...payload, authToken: await storageAdapter.get("lisa-jwt-token") ?? undefined });
        break;
      }

      case "updateItem": {
        const payload = mutation.payload as UpdateItemPayload;
        await convex.mutation(api.items.updateItem, { ...payload, authToken: await storageAdapter.get("lisa-jwt-token") ?? undefined });
        break;
      }

      case "removeItem": {
        const payload = mutation.payload as RemoveItemPayload;
        await convex.mutation(api.items.removeItem, { ...payload, authToken: await storageAdapter.get("lisa-jwt-token") ?? undefined });
        break;
      }

      case "batchCheckItems": {
        const payload = mutation.payload as BatchCheckItemsPayload;
        await convex.mutation(api.items.batchCheckItems, { ...payload, authToken: await storageAdapter.get("lisa-jwt-token") ?? undefined });
        break;
      }

      case "batchUncheckItems": {
        const payload = mutation.payload as BatchUncheckItemsPayload;
        await convex.mutation(api.items.batchUncheckItems, { ...payload, authToken: await storageAdapter.get("lisa-jwt-token") ?? undefined });
        break;
      }

      case "batchDeleteItems": {
        const payload = mutation.payload as BatchDeleteItemsPayload;
        await convex.mutation(api.items.batchDeleteItems, { ...payload, authToken: await storageAdapter.get("lisa-jwt-token") ?? undefined });
        break;
      }

      case "createList": {
        const payload = mutation.payload as CreateListPayload;
        await convex.mutation(api.lists.createList, { ...payload, authToken: await storageAdapter.get("lisa-jwt-token") ?? undefined });
        break;
      }

      case "renameList": {
        const payload = mutation.payload as RenameListPayload;
        await convex.mutation(api.lists.renameList, { ...payload, authToken: await storageAdapter.get("lisa-jwt-token") ?? undefined });
        break;
      }

      case "deleteList": {
        const payload = mutation.payload as DeleteListPayload;
        await convex.mutation(api.lists.deleteList, { ...payload, authToken: await storageAdapter.get("lisa-jwt-token") ?? undefined });
        break;
      }

      default: {
        // Type guard - should never happen with current MutationType
        const _exhaustiveCheck: never = mutation.type;
        throw new Error(`Unknown mutation type: ${_exhaustiveCheck}`);
      }
    }
  }

  /**
   * Delay execution for a specified number of milliseconds.
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Subscribe to sync status updates.
   *
   * @param listener - Callback function called with status updates
   * @returns Unsubscribe function to remove the listener
   */
  subscribe(listener: (status: SyncStatus) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Notify all listeners of a status change.
   */
  private notify(status: SyncStatus): void {
    this.listeners.forEach((listener) => listener(status));
  }

  /**
   * Check if sync is currently in progress.
   */
  get syncing(): boolean {
    return this.isSyncing;
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

/**
 * Singleton SyncManager instance for app-wide use.
 */
export const syncManager = new SyncManager();
