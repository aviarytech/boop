/**
 * Hook for optimistic item management (Phase 5.5)
 *
 * Provides optimistic UI updates for item mutations, queuing mutations when
 * offline and merging with server state when back online.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { useOffline } from "./useOffline";
import { queueMutation, cacheItems, getCachedItemsByList, type OfflineItem } from "../lib/offline";

/**
 * Extended item type with optimistic flag for UI styling
 */
export interface OptimisticItem extends Doc<"items"> {
  /** Flag for UI styling (e.g., dimmed) - indicates item has pending changes */
  _isOptimistic?: boolean;
}

/**
 * Hook for managing items with optimistic updates.
 *
 * Wraps Convex queries and mutations with optimistic update logic:
 * - Shows new items immediately with temp IDs
 * - Shows check/uncheck changes immediately
 * - Queues mutations when offline for later sync
 * - Rolls back on failure
 * - Cleans up optimistic state when server catches up
 *
 * @param listId - The ID of the list to manage items for
 * @returns Items array and mutation functions
 *
 * @example
 * ```tsx
 * function ItemList({ listId }) {
 *   const { items, addItem, checkItem, uncheckItem, isLoading } = useOptimisticItems(listId);
 *
 *   if (isLoading) return <Spinner />;
 *
 *   return (
 *     <>
 *       {items.map(item => (
 *         <div key={item._id} className={item._isOptimistic ? "opacity-60" : ""}>
 *           {item.name}
 *         </div>
 *       ))}
 *     </>
 *   );
 * }
 * ```
 */
export function useOptimisticItems(listId: Id<"lists">) {
  const { isOnline } = useOffline();
  const serverItems = useQuery(api.items.getListItems, { listId });
  const [optimisticItems, setOptimisticItems] = useState<OptimisticItem[]>([]);
  const [cachedItems, setCachedItems] = useState<OfflineItem[]>([]);

  // Keep a ref to the last known server items so we don't flash stale data
  // during Convex WebSocket reconnections (when serverItems briefly becomes undefined)
  const lastServerItemsRef = useRef<Doc<"items">[] | undefined>(undefined);
  if (serverItems !== undefined) {
    lastServerItemsRef.current = serverItems;
  }

  // Cache items when online and data is available
  useEffect(() => {
    if (serverItems && isOnline) {
      const itemsToCache = serverItems.map((item) => ({
        _id: item._id,
        listId: item.listId,
        name: item.name,
        checked: item.checked,
        createdByDid: item.createdByDid,
        checkedByDid: item.checkedByDid,
        createdAt: item.createdAt,
        checkedAt: item.checkedAt,
        order: item.order,
        // Enhanced fields
        description: item.description,
        dueDate: item.dueDate,
        url: item.url,
        recurrence: item.recurrence,
        assigneeDid: (item as Doc<"items"> & { assigneeDid?: string }).assigneeDid,
      }));
      cacheItems(itemsToCache);
    }
  }, [serverItems, isOnline]);

  // Clean up stale optimistic items when server state catches up.
  // This prevents unbounded growth and eliminates stale data during reconnections.
  useEffect(() => {
    if (!serverItems) return;
    setOptimisticItems((prev) => {
      if (prev.length === 0) return prev;
      const serverMap = new Map(serverItems.map((s) => [s._id, s]));
      const filtered = prev.filter((o) => {
        // Keep temp items that haven't appeared on server yet
        if ((o._id as string).startsWith("temp-")) {
          return !serverItems.some(
            (s) =>
              s.name === o.name &&
              s.createdByDid === o.createdByDid &&
              Math.abs(s.createdAt - o.createdAt) < 5000
          );
        }
        // Keep non-temp items only if server hasn't caught up (checked state differs)
        const serverItem = serverMap.get(o._id);
        return serverItem !== undefined && serverItem.checked !== o.checked;
      });
      // Only update state if something actually changed
      return filtered.length === prev.length ? prev : filtered;
    });
  }, [serverItems]);

  // Load cached items when offline
  useEffect(() => {
    if (!isOnline && !serverItems) {
      getCachedItemsByList(listId).then(setCachedItems);
    }
  }, [isOnline, serverItems, listId]);

  // Derive usingCache from whether we're showing cached data
  const usingCache = !isOnline && !serverItems && cachedItems.length > 0;

  const addItemMutation = useMutation(api.items.addItem);
  const checkItemMutation = useMutation(api.items.checkItem);
  const uncheckItemMutation = useMutation(api.items.uncheckItem);
  const reorderItemsMutation = useMutation(api.items.reorderItems);
  const updateItemMutation = useMutation(api.items.updateItem);
  const removeItemMutation = useMutation(api.items.removeItem);

  /**
   * Add item with optimistic update.
   * Shows the item immediately, then syncs with server or queues for offline.
   */
  const addItem = useCallback(
    async (args: {
      name: string;
      createdByDid: string;
      legacyDid?: string;
      createdAt: number;
    }) => {
      const tempId = `temp-${Date.now()}` as Id<"items">;
      // Calculate min order to put new item at top
      const currentItems = lastServerItemsRef.current ?? [];
      const minOrder = currentItems.reduce(
        (min, item) => Math.min(min, item.order ?? 0),
        0
      );
      const optimistic: OptimisticItem = {
        _id: tempId,
        _creationTime: Date.now(),
        listId,
        name: args.name,
        checked: false,
        createdByDid: args.createdByDid,
        createdAt: args.createdAt,
        order: minOrder - 1, // Add at top
        _isOptimistic: true,
      };

      // Add to beginning of optimistic items for immediate top placement
      setOptimisticItems((prev) => [optimistic, ...prev]);

      if (isOnline) {
        try {
          await addItemMutation({ listId, ...args });
        } catch (err) {
          // Rollback: remove the optimistic item on failure
          setOptimisticItems((prev) => prev.filter((i) => i._id !== tempId));
          throw err;
        }
      } else {
        await queueMutation({
          type: "addItem",
          payload: { listId, ...args },
          timestamp: Date.now(),
          retryCount: 0,
        });
      }
    },
    [isOnline, listId, addItemMutation]  // lastServerItemsRef is a ref, no need in deps
  );

  /**
   * Check item with optimistic update.
   * Shows the checked state immediately, then syncs or queues.
   */
  const checkItem = useCallback(
    async (itemId: Id<"items">, checkedByDid: string, legacyDid?: string) => {
      const checkedAt = Date.now();

      // Use ref for finding original item to avoid stale closure issues
      const currentServerItems = lastServerItemsRef.current ?? [];

      setOptimisticItems((prev) => {
        // If item exists in optimistic list, update it
        const exists = prev.some((i) => i._id === itemId);
        if (exists) {
          return prev.map((i) =>
            i._id === itemId
              ? {
                  ...i,
                  checked: true,
                  checkedByDid,
                  checkedAt,
                  _isOptimistic: true,
                }
              : i
          );
        }
        // If not in optimistic list, find the server item and add with optimistic update
        const originalItem = [...currentServerItems, ...prev].find(
          (i) => i._id === itemId
        );
        if (originalItem) {
          return [
            ...prev,
            {
              ...originalItem,
              checked: true,
              checkedByDid,
              checkedAt,
              _isOptimistic: true,
            },
          ];
        }
        return prev;
      });

      if (isOnline) {
        try {
          await checkItemMutation({ itemId, checkedByDid, legacyDid, checkedAt });
        } catch (err) {
          // Rollback: remove the optimistic state
          setOptimisticItems((prev) => prev.filter((i) => i._id !== itemId));
          throw err;
        }
      } else {
        await queueMutation({
          type: "checkItem",
          payload: { itemId, checkedByDid, legacyDid, checkedAt },
          timestamp: Date.now(),
          retryCount: 0,
        });
      }
    },
    [isOnline, checkItemMutation]
  );

  /**
   * Uncheck item with optimistic update.
   * Shows the unchecked state immediately, then syncs or queues.
   */
  const uncheckItem = useCallback(
    async (itemId: Id<"items">, userDid: string, legacyDid?: string) => {
      // Use ref for finding original item to avoid stale closure issues
      const currentServerItems = lastServerItemsRef.current ?? [];

      setOptimisticItems((prev) => {
        const exists = prev.some((i) => i._id === itemId);
        if (exists) {
          return prev.map((i) =>
            i._id === itemId
              ? {
                  ...i,
                  checked: false,
                  checkedByDid: undefined,
                  checkedAt: undefined,
                  _isOptimistic: true,
                }
              : i
          );
        }
        const originalItem = [...currentServerItems, ...prev].find(
          (i) => i._id === itemId
        );
        if (originalItem) {
          return [
            ...prev,
            {
              ...originalItem,
              checked: false,
              checkedByDid: undefined,
              checkedAt: undefined,
              _isOptimistic: true,
            },
          ];
        }
        return prev;
      });

      if (isOnline) {
        try {
          await uncheckItemMutation({ itemId, userDid, legacyDid });
        } catch (err) {
          // Rollback: remove the optimistic state
          setOptimisticItems((prev) => prev.filter((i) => i._id !== itemId));
          throw err;
        }
      } else {
        await queueMutation({
          type: "uncheckItem",
          payload: { itemId, userDid, legacyDid },
          timestamp: Date.now(),
          retryCount: 0,
        });
      }
    },
    [isOnline, uncheckItemMutation]
  );

  /**
   * Reorder items.
   * For reorder, optimistic UI is already handled by drag-drop visuals.
   * Just queue if offline, execute if online.
   */
  const reorderItems = useCallback(
    async (itemIds: Id<"items">[], userDid: string, legacyDid?: string) => {
      if (isOnline) {
        await reorderItemsMutation({ listId, itemIds, userDid, legacyDid });
      } else {
        await queueMutation({
          type: "reorderItem",
          payload: { listId, itemIds, userDid, legacyDid },
          timestamp: Date.now(),
          retryCount: 0,
        });
      }
    },
    [isOnline, listId, reorderItemsMutation]
  );

  /**
   * Merge server items with optimistic items, filtering out stale optimistic items.
   * Falls back to last known server items during reconnection, or cached items when offline.
   *
   * - Apply optimistic updates to matching server items (only if server hasn't caught up)
   * - Include new optimistic items (temp IDs) that don't exist on server yet
   * - Filter out removed items (marked for deletion)
   * - Use last known server items during brief Convex reconnections to prevent flicker
   */
  const items = useMemo((): OptimisticItem[] => {
    // Priority: live server items > last known server items > offline cache > optimistic only
    const baseItems: Doc<"items">[] | undefined =
      serverItems ??
      lastServerItemsRef.current ??
      (!isOnline && cachedItems.length > 0
        ? (cachedItems as unknown as Doc<"items">[])
        : undefined);

    if (!baseItems) return optimisticItems.filter((o) => !(o as any)._removed);

    const baseIds = new Set(baseItems.map((i) => i._id));
    
    // Get IDs of items marked for removal
    const removedIds = new Set(
      optimisticItems.filter((o) => (o as any)._removed).map((o) => o._id)
    );

    // Filter optimistic items to only keep those that are still relevant
    const activeOptimisticItems = optimisticItems.filter((o) => {
      // Filter out removed items
      if ((o as any)._removed) return false;
      
      // For check/uncheck updates on existing items
      if (!(o._id as string).startsWith("temp-")) {
        const baseItem = baseItems.find((s) => s._id === o._id);
        // Keep if base hasn't caught up yet (checked state differs)
        return baseItem && baseItem.checked !== o.checked;
      }
      // For new items (temp IDs), keep if base doesn't have matching item yet
      const existsInBase = baseItems.some(
        (s) =>
          s.name === o.name &&
          s.createdByDid === o.createdByDid &&
          Math.abs(s.createdAt - o.createdAt) < 5000
      );
      return !existsInBase;
    });

    // Apply active optimistic updates to base items, filtering out removed items
    const merged = baseItems
      .filter((baseItem) => !removedIds.has(baseItem._id))
      .map((baseItem) => {
        const optimistic = activeOptimisticItems.find((o) => o._id === baseItem._id);
        return optimistic ?? baseItem;
      });

    // Add optimistic items that don't exist in base yet (temp IDs)
    const newOptimistic = activeOptimisticItems.filter(
      (o) =>
        (o._id as string).startsWith("temp-") || !baseIds.has(o._id)
    );

    return [...merged, ...newOptimistic];
  }, [serverItems, optimisticItems, isOnline, cachedItems]);

  /**
   * Update item with optimistic update.
   * Shows changes immediately, then syncs with server or queues for offline.
   */
  const updateItem = useCallback(
    async (args: {
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
    }) => {
      const currentServerItems = lastServerItemsRef.current ?? [];

      setOptimisticItems((prev) => {
        const exists = prev.some((i) => i._id === args.itemId);
        if (exists) {
          return prev.map((i) =>
            i._id === args.itemId
              ? {
                  ...i,
                  name: args.name ?? i.name,
                  description: args.clearDueDate ? undefined : (args.description ?? i.description),
                  dueDate: args.clearDueDate ? undefined : (args.dueDate ?? i.dueDate),
                  url: args.clearUrl ? undefined : (args.url ?? i.url),
                  recurrence: args.clearRecurrence ? undefined : (args.recurrence ?? i.recurrence),
                  priority: args.clearPriority ? undefined : (args.priority ?? i.priority),
                  groceryAisle: args.clearGroceryAisle ? undefined : (args.groceryAisle ?? i.groceryAisle),
                  _isOptimistic: true,
                }
              : i
          );
        }
        const originalItem = [...currentServerItems, ...prev].find(
          (i) => i._id === args.itemId
        );
        if (originalItem) {
          return [
            ...prev,
            {
              ...originalItem,
              name: args.name ?? originalItem.name,
              description: args.clearDueDate ? undefined : (args.description ?? originalItem.description),
              dueDate: args.clearDueDate ? undefined : (args.dueDate ?? originalItem.dueDate),
              url: args.clearUrl ? undefined : (args.url ?? originalItem.url),
              recurrence: args.clearRecurrence ? undefined : (args.recurrence ?? originalItem.recurrence),
              priority: args.clearPriority ? undefined : (args.priority ?? originalItem.priority),
              groceryAisle: args.clearGroceryAisle ? undefined : (args.groceryAisle ?? originalItem.groceryAisle),
              _isOptimistic: true,
            },
          ];
        }
        return prev;
      });

      if (isOnline) {
        try {
          await updateItemMutation(args);
        } catch (err) {
          // Rollback: remove the optimistic state
          setOptimisticItems((prev) => prev.filter((i) => i._id !== args.itemId));
          throw err;
        }
      } else {
        await queueMutation({
          type: "updateItem",
          payload: args,
          timestamp: Date.now(),
          retryCount: 0,
        });
      }
    },
    [isOnline, updateItemMutation]
  );

  /**
   * Remove item with optimistic update.
   * Hides the item immediately, then syncs with server or queues for offline.
   */
  const removeItem = useCallback(
    async (itemId: Id<"items">, userDid: string, legacyDid?: string) => {
      // Optimistically remove from display
      setOptimisticItems((prev) => [...prev, { _id: itemId, _removed: true } as any]);

      if (isOnline) {
        try {
          await removeItemMutation({ itemId, userDid, legacyDid });
        } catch (err) {
          // Rollback: remove the marker
          setOptimisticItems((prev) => prev.filter((i) => i._id !== itemId));
          throw err;
        }
      } else {
        await queueMutation({
          type: "removeItem",
          payload: { itemId, userDid, legacyDid },
          timestamp: Date.now(),
          retryCount: 0,
        });
      }
    },
    [isOnline, removeItemMutation]
  );

  return {
    items,
    addItem,
    checkItem,
    uncheckItem,
    reorderItems,
    updateItem,
    removeItem,
    isLoading: serverItems === undefined && (!usingCache || cachedItems.length === 0),
    /** Whether items are being displayed from cache (offline fallback) */
    usingCache,
  };
}
