/**
 * List view page showing items in a single list.
 *
 * Displays list header with actions, items, and add item input.
 * Features improved design, dark mode, and better empty states.
 * Supports list view and calendar view modes.
 */

import React, { useState, useCallback, useRef, lazy, Suspense, useEffect, useMemo } from "react";
import { useParams, useNavigate, useLocation, Link } from "react-router-dom";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id, Doc } from "../../convex/_generated/dataModel";
import { useCurrentUser } from "../hooks/useCurrentUser";
import { useOptimisticItems, type OptimisticItem } from "../hooks/useOptimisticItems";
import { useOffline } from "../hooks/useOffline";
import { useSettings } from "../hooks/useSettings";
import { useTouchDrag } from "../hooks/useTouchDrag";
import { useNotifications } from "../hooks/useNotifications";
import { useKeyboardShortcuts, KeyboardShortcutsHelp, type Shortcut } from "../hooks/useKeyboardShortcuts";
import { classifyItem } from "../lib/groceryAisles";
import { groupByCategory, resolveCategories, type Category } from "../lib/categories";
import { CategoryHeaderMenu } from "../components/CategoryHeaderMenu";
import { useCategories } from "../hooks/useCategories";
import { shareList } from "../lib/share";
import { recordLatencyMs, setGaugeMetric } from "../lib/observability";
import { AddItemInput } from "../components/AddItemInput";
import { NestedListItem } from "../components/NestedListItem";
import { useStreaks } from "../hooks/useStreaks";
import { StreakBadge } from "../components/StreakBadge";
import { LegacyBadge } from "../components/LegacyBadge";
import { StreakCelebration } from "../components/StreakCelebration";
import { NoItemsEmptyState } from "../components/ui/EmptyState";
import { ListViewSkeleton } from "../components/ui/Skeleton";
import { CalendarView } from "../components/CalendarView";
import { BatchOperations } from "../components/BatchOperations";
import { HeaderActionsMenu } from "../components/HeaderActionsMenu";
import { ListVerificationBadge, type VerificationState } from "../components/VerificationBadge";

// Lazy-loaded modals for better bundle splitting
const DeleteListDialog = lazy(() => import("../components/DeleteListDialog").then(m => ({ default: m.DeleteListDialog })));
const ShareModal = lazy(() => import("../components/ShareModal").then(m => ({ default: m.ShareModal })));
const PublishModal = lazy(() => import("../components/publish/PublishModal").then(m => ({ default: m.PublishModal })));
const ItemDetailsModal = lazy(() => import("../components/ItemDetailsModal").then(m => ({ default: m.ItemDetailsModal })));
const SaveAsTemplateModal = lazy(() => import("../components/SaveAsTemplateModal").then(m => ({ default: m.SaveAsTemplateModal })));
const RenameListDialog = lazy(() => import("../components/RenameListDialog").then(m => ({ default: m.RenameListDialog })));
const ChangeCategoryDialog = lazy(() => import("../components/ChangeCategoryDialog").then(m => ({ default: m.ChangeCategoryDialog })));

type ViewMode = "list" | "calendar";
type ItemViewMode = "alphabetical" | "categorized";

export function ListView() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { did, legacyDid, isLoading: userLoading } = useCurrentUser();
  const { haptic } = useSettings();
  const { scheduleItemsNotifications, isEnabled: notificationsEnabled } = useNotifications({ userDid: did });

  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isShareModalOpen, setIsShareModalOpen] = useState(
    () => !!(location.state as { openShare?: boolean } | null)?.openShare
  );
  const [isPublishModalOpen, setIsPublishModalOpen] = useState(false);
  const [isSaveTemplateModalOpen, setIsSaveTemplateModalOpen] = useState(false);
  const [isRenameDialogOpen, setIsRenameDialogOpen] = useState(false);
  const [isCategoryDialogOpen, setIsCategoryDialogOpen] = useState(false);
  const [draggedItemId, setDraggedItemId] = useState<Id<"items"> | null>(null);
  const [dragOverItemId, setDragOverItemId] = useState<Id<"items"> | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [doneCollapsed, setDoneCollapsed] = useState(true);
  // Store only IDs to avoid stale snapshots - we'll look up live items from the reactive items array
  const [selectedCalendarItemId, setSelectedCalendarItemId] = useState<Id<"items"> | null>(null);
  const itemsContainerRef = useRef<HTMLDivElement>(null);
  
  // Multi-select state
  const [isSelectMode, setIsSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<Id<"items">>>(new Set());
  
  // Keyboard navigation state
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);
  // Store only ID to avoid stale snapshots - we'll look up live item from the reactive items array
  const [editingItemId, setEditingItemId] = useState<Id<"items"> | null>(null);
  const addItemInputRef = useRef<HTMLInputElement>(null);

  const listId = id as Id<"lists">;
  const list = useQuery(api.lists.getList, { listId });

  // Same source of truth as the list index, asked for one id.
  const legacyIds = useQuery(
    api.lists.getLegacyListIds,
    list ? { listIds: [list._id] } : "skip"
  );
  const isLegacyList = (legacyIds?.length ?? 0) > 0;
  const listLoadStartedAtRef = useRef(performance.now());
  const hasRecordedRenderLatencyRef = useRef(false);

  // Use optimistic items hook (with offline cache fallback)
  const {
    items,
    addItem,
    checkItem,
    uncheckItem,
    reorderItems,
    isLoading: itemsLoading,
    usingCache,
  } = useOptimisticItems(listId);
  
  // Streak tracking
  const { streak, recordTaskCompletion } = useStreaks(did ?? undefined);
  const [celebrationMilestone, setCelebrationMilestone] = useState<number | null>(null);

  useEffect(() => {
    if (hasRecordedRenderLatencyRef.current) return;
    if (!list || itemsLoading) return;

    hasRecordedRenderLatencyRef.current = true;
    recordLatencyMs("list_render_latency_ms", performance.now() - listLoadStartedAtRef.current, {
      route: `/list/${listId}`,
      env: import.meta.env.MODE,
    });
  }, [list, itemsLoading, listId]);

  useEffect(() => {
    setGaugeMetric("active_presence_sessions", 1, {
      route: `/list/${listId}`,
      env: import.meta.env.MODE,
    });

    return () => {
      setGaugeMetric("active_presence_sessions", 0, {
        route: `/list/${listId}`,
        env: import.meta.env.MODE,
      });
    };
  }, [listId]);

  // Wrap checkItem to also record streak
  const checkItemWithStreak = useCallback(
    async (itemId: Id<"items">, checkedByDid: string, legacyDid?: string) => {
      await checkItem(itemId, checkedByDid, legacyDid);
      const milestone = recordTaskCompletion();
      if (milestone !== null) {
        setCelebrationMilestone(milestone);
      }
    },
    [checkItem, recordTaskCompletion]
  );

  // Mutation for removing items via keyboard
  const removeItemMutation = useMutation(api.items.removeItem);
  const updateItemMutation = useMutation(api.items.updateItem);

  // Custom aisle state
  const addCategoryMutation = useMutation(api.itemCategories.addListCategory);
  const renameCategoryMutation = useMutation(api.itemCategories.renameListCategory);
  const setCategoryEmojiMutation = useMutation(api.itemCategories.setListCategoryEmoji);
  const moveCategoryMutation = useMutation(api.itemCategories.moveListCategory);
  const deleteCategoryMutation = useMutation(api.itemCategories.deleteListCategory);
  const [showAddAisle, setShowAddAisle] = useState(false);
  const [newAisleName, setNewAisleName] = useState("");
  const [newAisleEmoji, setNewAisleEmoji] = useState("🏷️");

  // Multi-select callbacks (after items is defined)
  const toggleSelection = useCallback((itemId: Id<"items">) => {
    haptic('light');
    setSelectedIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(itemId)) {
        newSet.delete(itemId);
      } else {
        newSet.add(itemId);
      }
      // Exit select mode if no items selected
      if (newSet.size === 0) {
        setIsSelectMode(false);
      }
      return newSet;
    });
  }, [haptic]);

  const enterSelectMode = useCallback((itemId: Id<"items">) => {
    haptic('medium');
    setIsSelectMode(true);
    setSelectedIds(new Set([itemId]));
  }, [haptic]);

  const selectAll = useCallback(() => {
    haptic('light');
    setSelectedIds(new Set(items.map(item => item._id)));
  }, [items, haptic]);

  const clearSelection = useCallback(() => {
    haptic('light');
    setSelectedIds(new Set());
    setIsSelectMode(false);
  }, [haptic]);

  // Detect grocery lists by category name
  const { categories } = useCategories();

  // Sorted items for consistent keyboard navigation
  const sortedItems = useMemo(() => {
    return [...items].sort((a, b) => {
      if (a.checked !== b.checked) {
        return a.checked ? 1 : -1;
      }
      const orderA = a.order ?? a.createdAt;
      const orderB = b.order ?? b.createdAt;
      return orderA - orderB;
    });
  }, [items]);

  // Detect grocery lists by category name
  const isGroceryList = useMemo(() => {
    if (!list || !list.categoryId) return false;
    const cat = categories.find((c: { _id: Id<"categories">; name: string }) => c._id === list.categoryId);
    if (cat) return cat.name.toLowerCase().includes("grocer");
    // Fallback: for shared lists, the category belongs to the owner's data,
    // so check the list name instead.
    return list.name?.toLowerCase().includes("grocer") ?? false;
  }, [list, categories]);

  // Item view mode (alphabetical vs categorized) — local state for instant feedback, persisted to list doc
  const updateItemViewModeMutation = useMutation(api.lists.updateItemViewMode);
  const serverItemViewMode: ItemViewMode = (list as any)?.itemViewMode ?? (isGroceryList ? "categorized" : "alphabetical");
  const [localItemViewMode, setLocalItemViewMode] = useState<ItemViewMode | null>(null);
  const itemViewMode: ItemViewMode = localItemViewMode ?? serverItemViewMode;

  // Sync local override back to null when server catches up
  useEffect(() => {
    if (localItemViewMode && localItemViewMode === serverItemViewMode) {
      setLocalItemViewMode(null);
    }
  }, [localItemViewMode, serverItemViewMode]);

  // Grocery aisle grouping when in categorized mode - only top-level items
  const aisleGroups = useMemo(() => {
    if (itemViewMode !== "categorized") return null;
    const unchecked = sortedItems.filter(item => !item.checked && !item.parentId);
    const checked = sortedItems.filter(item => item.checked && !item.parentId);
    const listRow = list as unknown as { itemCategories?: Category[]; customAisles?: Category[] } | undefined;
    // A list that has not been edited yet has no itemCategories and falls back
    // to the grocery defaults; customAisles are only folded in on first edit.
    const categories = resolveCategories(listRow?.itemCategories);
    return {
      groups: groupByCategory(unchecked.map(item => ({ ...item, name: item.name ?? "" })), categories),
      checked,
      categories,
    };
  }, [itemViewMode, sortedItems, list]);

  // Look up live items by ID to avoid stale snapshots in modals
  // This ensures tags and other fields update in real-time
  const editingItem = useMemo(() => {
    if (!editingItemId) return null;
    return items.find(item => item._id === editingItemId) as Doc<"items"> | undefined ?? null;
  }, [items, editingItemId]);

  const selectedCalendarItem = useMemo(() => {
    if (!selectedCalendarItemId) return null;
    return items.find(item => item._id === selectedCalendarItemId) as Doc<"items"> | undefined ?? null;
  }, [items, selectedCalendarItemId]);

  // Get publication status
  const publicationStatus = useQuery(api.publication.getPublicationStatus, { listId });

  // Favourite (bookmark) state
  const bookmarkMutation = useMutation(api.publication.bookmarkList);
  const unbookmarkMutation = useMutation(api.publication.unbookmarkList);
  const isBookmarked = useQuery(
    api.publication.isBookmarked,
    did ? { listId, userDid: did } : "skip"
  );
  const [favouritePending, setFavouritePending] = useState(false);

  const handleToggleFavourite = useCallback(async () => {
    if (!did || favouritePending) return;
    setFavouritePending(true);
    haptic("light");
    try {
      if (isBookmarked) {
        await unbookmarkMutation({ listId, userDid: did });
      } else {
        await bookmarkMutation({ listId, userDid: did });
      }
    } catch (err) {
      console.error("Failed to toggle favourite:", err);
      haptic("error");
    } finally {
      setFavouritePending(false);
    }
  }, [did, favouritePending, haptic, isBookmarked, unbookmarkMutation, listId, bookmarkMutation]);

  // Get online status for disabling destructive operations
  const { isOnline } = useOffline();

  // Schedule notifications for items with due dates
  // Note: The actual items array type from useOptimisticItems includes Doc<"items"> properties
  useEffect(() => {
    if (notificationsEnabled && items.length > 0) {
      // Filter items that have dueDate and pass them to the scheduler
      const itemsWithDueDates = items.filter(item => 'dueDate' in item && item.dueDate);
      if (itemsWithDueDates.length > 0) {
        // Cast to the expected type - items from the query have the full Doc<"items"> shape
        scheduleItemsNotifications(itemsWithDueDates as unknown as import("../../convex/_generated/dataModel").Doc<"items">[]);
      }
    }
  }, [items, notificationsEnabled, scheduleItemsNotifications]);

  const handleDragStart = useCallback((itemId: Id<"items">) => {
    haptic('light');
    setDraggedItemId(itemId);
  }, [haptic]);

  const handleDragOver = useCallback(
    (e: React.DragEvent, itemId: Id<"items">) => {
      e.preventDefault();
      if (draggedItemId && draggedItemId !== itemId) {
        setDragOverItemId(itemId);
      }
    },
    [draggedItemId]
  );

  const handleDragEnd = useCallback(async () => {
    if (!draggedItemId || !dragOverItemId || items.length === 0 || !did) {
      setDraggedItemId(null);
      setDragOverItemId(null);
      return;
    }

    const itemIds = items.map((item) => item._id);
    const draggedIndex = itemIds.indexOf(draggedItemId);
    const targetIndex = itemIds.indexOf(dragOverItemId);

    if (
      draggedIndex !== -1 &&
      targetIndex !== -1 &&
      draggedIndex !== targetIndex
    ) {
      haptic('medium');
      const newItemIds = [...itemIds];
      newItemIds.splice(draggedIndex, 1);
      newItemIds.splice(targetIndex, 0, draggedItemId);
      await reorderItems(newItemIds, did, legacyDid ?? undefined);
    }

    setDraggedItemId(null);
    setDragOverItemId(null);
  }, [draggedItemId, dragOverItemId, items, did, legacyDid, reorderItems, haptic]);

  // Touch drag reorder handler
  const handleTouchReorder = useCallback(async (draggedId: string, targetId: string) => {
    if (items.length === 0 || !did) return;

    const itemIds = items.map((item) => item._id);
    const draggedIndex = itemIds.indexOf(draggedId as Id<"items">);
    const targetIndex = itemIds.indexOf(targetId as Id<"items">);

    if (draggedIndex !== -1 && targetIndex !== -1 && draggedIndex !== targetIndex) {
      haptic('medium');
      const newItemIds = [...itemIds];
      newItemIds.splice(draggedIndex, 1);
      newItemIds.splice(targetIndex, 0, draggedId as Id<"items">);
      await reorderItems(newItemIds, did, legacyDid ?? undefined);
    }
  }, [items, did, legacyDid, reorderItems, haptic]);

  // Touch drag hook for mobile support
  const touchDrag = useTouchDrag({
    onReorder: handleTouchReorder,
    containerRef: itemsContainerRef,
  });

  // Grocery aisle drag — detect which aisle section a dragged item lands in
  const handleGroceryTouchReorder = useCallback(async (draggedId: string, _targetId: string) => {
    if (!did || !itemsContainerRef.current) return;
    // Find which aisle the target item belongs to by walking up the DOM
    const targetEl = itemsContainerRef.current.querySelector(`[data-item-id="${_targetId}"]`);
    if (!targetEl) return;
    const aisleContainer = targetEl.closest('[data-aisle-id]');
    if (!aisleContainer) return;
    const targetAisleId = aisleContainer.getAttribute('data-aisle-id');
    if (!targetAisleId) return;

    // Find the dragged item's current aisle
    const draggedItem = sortedItems.find(i => i._id === draggedId);
    if (!draggedItem) return;
    const currentAisleId = (draggedItem as OptimisticItem & { groceryAisle?: string }).groceryAisle || classifyItem(draggedItem.name);

    if (targetAisleId === currentAisleId) return; // Same aisle, nothing to do

    haptic('medium');
    await updateItemMutation({
      itemId: draggedId as Id<"items">,
      userDid: did,
      legacyDid: legacyDid ?? undefined,
      groceryAisle: targetAisleId,
    });
  }, [did, legacyDid, sortedItems, haptic, updateItemMutation]);

  const groceryTouchDrag = useTouchDrag({
    onReorder: handleGroceryTouchReorder,
    containerRef: itemsContainerRef,
  });

  // Determine which aisle is being dragged over (for header highlighting)
  const dragOverAisleId = useMemo(() => {
    if (!aisleGroups) return null;
    const overId = groceryTouchDrag.state.dragOverId;
    if (!overId) return null;
    for (const { category: aisle, items: aisleItems } of aisleGroups.groups) {
      if (aisleItems.some(i => i._id === overId)) return aisle.id;
    }
    return null;
  }, [aisleGroups, groceryTouchDrag.state.dragOverId]);

  // Native share handler
  const handleNativeShare = useCallback(async () => {
    if (!list) return;
    
    const listUrl = `${window.location.origin}/d/${list._id}`;
    
    try {
      await shareList(list.name, listUrl);
      haptic('success');
    } catch (error) {
      console.error('Share failed:', error);
      haptic('error');
    }
  }, [list, haptic]);

  // Keyboard shortcuts for power users
  const shortcuts: Shortcut[] = useMemo(() => {
    const canUserEditNow = true; // Published lists or owned = can edit
    
    return [
      {
        key: "n",
        description: "New item (focus input)",
        action: () => {
          if (canUserEditNow) {
            addItemInputRef.current?.focus();
          }
        },
      },
      {
        key: "/",
        description: "Focus add item input",
        action: () => {
          if (canUserEditNow) {
            addItemInputRef.current?.focus();
          }
        },
      },
      {
        key: "j",
        description: "Move focus down",
        action: () => {
          if (sortedItems.length === 0) return;
          setFocusedIndex((prev) => {
            if (prev === null) return 0;
            return Math.min(prev + 1, sortedItems.length - 1);
          });
        },
      },
      {
        key: "k",
        description: "Move focus up",
        action: () => {
          if (sortedItems.length === 0) return;
          setFocusedIndex((prev) => {
            if (prev === null) return sortedItems.length - 1;
            return Math.max(prev - 1, 0);
          });
        },
      },
      {
        key: "ArrowDown",
        description: "Move focus down",
        action: () => {
          if (sortedItems.length === 0) return;
          setFocusedIndex((prev) => {
            if (prev === null) return 0;
            return Math.min(prev + 1, sortedItems.length - 1);
          });
        },
      },
      {
        key: "ArrowUp",
        description: "Move focus up",
        action: () => {
          if (sortedItems.length === 0) return;
          setFocusedIndex((prev) => {
            if (prev === null) return sortedItems.length - 1;
            return Math.max(prev - 1, 0);
          });
        },
      },
      {
        key: "x",
        description: "Toggle check on focused item",
        action: () => {
          if (!canUserEditNow || focusedIndex === null || !did) return;
          const item = sortedItems[focusedIndex];
          if (item) {
            if (item.checked) {
              uncheckItem(item._id, did, legacyDid ?? undefined);
            } else {
              checkItemWithStreak(item._id, did, legacyDid ?? undefined);
            }
          }
        },
      },
      {
        key: " ",
        description: "Toggle check on focused item",
        action: () => {
          if (!canUserEditNow || focusedIndex === null || !did) return;
          const item = sortedItems[focusedIndex];
          if (item) {
            if (item.checked) {
              uncheckItem(item._id, did, legacyDid ?? undefined);
            } else {
              checkItemWithStreak(item._id, did, legacyDid ?? undefined);
            }
          }
        },
      },
      {
        key: "e",
        description: "Edit focused item",
        action: () => {
          if (focusedIndex === null) return;
          const item = sortedItems[focusedIndex];
          if (item) {
            setEditingItemId(item._id);
          }
        },
      },
      {
        key: "Enter",
        description: "Edit focused item",
        action: () => {
          if (focusedIndex === null) return;
          const item = sortedItems[focusedIndex];
          if (item) {
            setEditingItemId(item._id);
          }
        },
      },
      {
        key: "d",
        description: "Delete focused item",
        action: () => {
          if (!canUserEditNow || focusedIndex === null || !did) return;
          const item = sortedItems[focusedIndex];
          if (item) {
            haptic('medium');
            removeItemMutation({ itemId: item._id, userDid: did });
            // Move focus up if at end of list
            if (focusedIndex >= sortedItems.length - 1) {
              setFocusedIndex(Math.max(0, sortedItems.length - 2));
            }
          }
        },
      },
      {
        key: "Delete",
        description: "Delete focused item",
        action: () => {
          if (!canUserEditNow || focusedIndex === null || !did) return;
          const item = sortedItems[focusedIndex];
          if (item) {
            haptic('medium');
            removeItemMutation({ itemId: item._id, userDid: did });
            // Move focus up if at end of list
            if (focusedIndex >= sortedItems.length - 1) {
              setFocusedIndex(Math.max(0, sortedItems.length - 2));
            }
          }
        },
      },
      {
        key: "Backspace",
        description: "Delete focused item",
        action: () => {
          if (!canUserEditNow || focusedIndex === null || !did) return;
          const item = sortedItems[focusedIndex];
          if (item) {
            haptic('medium');
            removeItemMutation({ itemId: item._id, userDid: did });
            // Move focus up if at end of list
            if (focusedIndex >= sortedItems.length - 1) {
              setFocusedIndex(Math.max(0, sortedItems.length - 2));
            }
          }
        },
      },
      {
        key: "Escape",
        description: "Clear focus / close modals",
        action: () => {
          setFocusedIndex(null);
          setEditingItemId(null);
          if (isSelectMode) {
            clearSelection();
          }
        },
      },
    ];
  }, [sortedItems, focusedIndex, did, legacyDid, checkItemWithStreak, uncheckItem, removeItemMutation, haptic, isSelectMode, clearSelection]);

  const { showHelp, setShowHelp } = useKeyboardShortcuts({
    enabled: viewMode === "list" && !editingItem,
    shortcuts,
  });


  // Reset focus when items change significantly
  useEffect(() => {
    if (focusedIndex !== null && focusedIndex >= sortedItems.length) {
      setFocusedIndex(sortedItems.length > 0 ? sortedItems.length - 1 : null);
    }
  }, [sortedItems.length, focusedIndex]);

  // Loading state
  if (
    userLoading ||
    !did ||
    list === undefined ||
    itemsLoading
  ) {
    return <ListViewSkeleton />;
  }

  if (list === null) {
    return (
      <div className="text-center py-16">
        <div className="text-6xl mb-4">🔍</div>
        <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-2">
          List not found
        </h2>
        <p className="text-gray-500 dark:text-gray-400 mb-6">
          This list may have been deleted or you don't have access.
        </p>
        <Link 
          to="/d"
          className="inline-flex items-center gap-2 px-6 py-3 bg-amber-500 hover:bg-amber-600 text-white rounded-xl font-semibold transition-colors"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          Back to lists
        </Link>
      </div>
    );
  }

  // Check authorization: owner always has access, published lists are open
  const userDids = [did, legacyDid].filter(Boolean) as string[];
  const userIsOwner = userDids.includes(list.ownerDid);
  const isPublished = publicationStatus?.status === "active";

  if (!userIsOwner && !isPublished) {
    return (
      <div className="text-center py-16">
        <div className="text-6xl mb-4">🔒</div>
        <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-2">
          Access denied
        </h2>
        <p className="text-gray-500 dark:text-gray-400 mb-6">
          This list is not shared. Ask the owner to publish it.
        </p>
        <Link 
          to="/d"
          className="inline-flex items-center gap-2 px-6 py-3 bg-amber-500 hover:bg-amber-600 text-white rounded-xl font-semibold transition-colors"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          Back to lists
        </Link>
      </div>
    );
  }

  // Everyone with access can edit (owner or published list visitor)
  const canUserEdit = true;
  const canUserInvite = userIsOwner;
  const canUserDelete = userIsOwner;

  // Count checked/unchecked items
  const checkedCount = items.filter(item => item.checked).length;
  const totalCount = items.length;

  return (
    <div

      className="max-w-3xl mx-auto"
    >
      {/* Header - Redesigned for less crowding */}
      <div className="mb-6">
        <div className="flex items-start gap-3">
          {/* Back button */}
          <Link
            to="/d"
            onClick={() => haptic('light')}
            className="flex-shrink-0 w-10 h-10 flex items-center justify-center text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-xl transition-colors"
            aria-label="Back to lists"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>

          {/* Title and info - takes remaining space */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1
                className="text-gray-900 dark:text-gray-100 break-words min-w-0"
                style={{
                  fontFamily: 'Nunito, system-ui, sans-serif',
                  fontWeight: 700,
                  fontSize: 'clamp(24px, 4.5vw, 32px)',
                  letterSpacing: -0.9,
                  lineHeight: 1.05,
                  margin: 0,
                }}
              >
                {list.name}
              </h1>
              {streak > 0 && <StreakBadge streak={streak} size="sm" />}
            {isLegacyList && <LegacyBadge />}
            {/* Verification badge for list */}
            <ListVerificationBadge
              hasVC={!!list.assetDid}
              anchorStatus={(publicationStatus?.anchorStatus as VerificationState) ?? "none"}
              did={list.assetDid}
              anchorBlockHeight={publicationStatus?.anchorBlockHeight}
              anchorTxId={publicationStatus?.anchorTxId}
            />
            </div>

            {/* Progress and collaborators info */}
            <div
              className="flex items-center gap-2 text-[12px] mt-1 text-stone-500 dark:text-stone-400"
              style={{ fontFamily: 'Geist Mono, ui-monospace, monospace' }}
            >
            {totalCount > 0 && (
              <span>
                {checkedCount}/{totalCount} done
              </span>
            )}

            {isPublished && (
              <>
                <span className="text-stone-300 dark:text-stone-600">·</span>
                <span className="inline-flex items-center gap-1">
                  <span
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: '50%',
                      background: '#1a7a4c',
                      display: 'inline-block',
                    }}
                    aria-hidden="true"
                  />
                  shared
                </span>
              </>
            )}
            </div>

            {/* Progress bar — only show if there are items */}
            {totalCount > 0 && (
              <div className="flex items-center gap-2.5 mt-3 max-w-md">
                <div className="flex-1 h-[6px] rounded-full overflow-hidden bg-stone-200/70 dark:bg-stone-700/60">
                  <div
                    className="h-full rounded-full transition-[width] duration-300"
                    style={{
                      width: `${Math.round((checkedCount / totalCount) * 100)}%`,
                      background: 'var(--boop-accent)',
                    }}
                  />
                </div>
                <span
                  className="text-[11px] font-semibold tabular-nums"
                  style={{
                    color: 'var(--boop-accent)',
                    fontFamily: 'Geist Mono, ui-monospace, monospace',
                  }}
                >
                  {Math.round((checkedCount / totalCount) * 100)}%
                </span>
              </div>
            )}
          </div>

          {/* Compact action buttons */}
          <div className="flex items-center gap-2 flex-shrink-0">
          {/* View toggle - compact on mobile */}
          <div className="inline-flex items-center bg-gray-100 dark:bg-gray-800 rounded-full p-0.5">
            <button
              onClick={() => {
                haptic('light');
                setViewMode("list");
                if (itemViewMode !== "alphabetical") {
                  setLocalItemViewMode("alphabetical");
                  updateItemViewModeMutation({ listId, itemViewMode: "alphabetical", userDid: did });
                }
              }}
              className={`p-1.5 sm:px-2.5 sm:py-1.5 rounded-full transition-all active:scale-95 ${
                viewMode === "list" && itemViewMode === "alphabetical"
                  ? "bg-white dark:bg-gray-600 text-amber-600 dark:text-amber-400 shadow-sm"
                  : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
              }`}
              aria-label="Alphabetical view"
              title="Alphabetical view (A-Z)"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
              </svg>
            </button>
            <button
              onClick={() => {
                haptic('light');
                setViewMode("list");
                if (itemViewMode !== "categorized") {
                  setLocalItemViewMode("categorized");
                  updateItemViewModeMutation({ listId, itemViewMode: "categorized", userDid: did });
                }
              }}
              className={`p-1.5 sm:px-2.5 sm:py-1.5 rounded-full transition-all active:scale-95 ${
                viewMode === "list" && itemViewMode === "categorized"
                  ? "bg-white dark:bg-gray-600 text-amber-600 dark:text-amber-400 shadow-sm"
                  : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
              }`}
              aria-label="Categorized view"
              title="Categorized view (grouped by category)"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
            </button>
            <button
              onClick={() => {
                haptic('light');
                setViewMode("calendar");
              }}
              className={`p-1.5 sm:px-2.5 sm:py-1.5 rounded-full transition-all active:scale-95 ${
                viewMode === "calendar"
                  ? "bg-white dark:bg-gray-600 text-amber-600 dark:text-amber-400 shadow-sm"
                  : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
              }`}
              aria-label="Calendar view"
              title="Calendar view"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </button>
          </div>

          {/* Favourite button */}
          {did && (
            <button
              onClick={handleToggleFavourite}
              disabled={favouritePending}
              className={`inline-flex items-center justify-center p-2 rounded-full transition-all active:scale-95 ${
                isBookmarked
                  ? "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 border border-amber-300 dark:border-amber-700"
                  : "bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700"
              } ${favouritePending ? "opacity-50" : ""}`}
              aria-label={isBookmarked ? "Remove from favourites" : "Add to favourites"}
              title={isBookmarked ? "Remove from favourites" : "Add to favourites"}
            >
              <span className="text-sm leading-none">{isBookmarked ? "⭐" : "☆"}</span>
            </button>
          )}

          {/* Share button - always visible as it's commonly used */}
          {canUserInvite && (
            <button
              onClick={() => {
                haptic('light');
                setIsShareModalOpen(true);
              }}
              className="inline-flex items-center justify-center p-2 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 transition-all active:scale-95"
              aria-label="Share"
              title="Share list"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
              </svg>
            </button>
          )}

          {/* More actions menu - consolidates Publish, Template, Delete, Keyboard shortcuts */}
          <HeaderActionsMenu
            canShare={canUserInvite}
            canPublish={canUserDelete}
            canSaveTemplate={canUserEdit}
            canDelete={canUserDelete}
            canRename={canUserDelete}
            isOnline={isOnline}
            isPublished={publicationStatus?.status === "active"}
            onShare={() => setIsShareModalOpen(true)}
            onNativeShare={handleNativeShare}
            onPublish={() => setIsPublishModalOpen(true)}
            onSaveTemplate={() => setIsSaveTemplateModalOpen(true)}
            onDelete={() => setIsDeleteDialogOpen(true)}
            onRename={() => setIsRenameDialogOpen(true)}
            canChangeCategory={canUserDelete}
            onChangeCategory={() => setIsCategoryDialogOpen(true)}
            onKeyboardShortcuts={() => setShowHelp(true)}
            haptic={haptic}
          />
          </div>
        </div>
      </div>

      {/* Cached data indicator */}
      {usingCache && (
        <div className="mb-4 px-4 py-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl text-amber-700 dark:text-amber-400 text-sm flex items-center gap-3 animate-slide-up">
          <span className="text-xl">📡</span>
          <span>Showing cached items. Some info may be outdated.</span>
        </div>
      )}

      {/* Amber progress bar */}
      {totalCount > 0 && (
        <div className="mb-4 bg-amber-100 dark:bg-amber-900/30 rounded-full h-2.5 overflow-hidden">
          <div 
            className="h-full bg-amber-500 transition-all duration-500 ease-out rounded-full"
            style={{ width: `${(checkedCount / totalCount) * 100}%` }}
          />
        </div>
      )}

      {/* Select mode header */}
      {isSelectMode && canUserEdit && (
        <div className="mb-4 px-4 py-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl flex items-center justify-between animate-slide-up">
          <span className="text-sm font-medium text-amber-700 dark:text-amber-400">
            {selectedIds.size} of {totalCount} selected
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={selectAll}
              className="px-3 py-1.5 text-xs font-medium text-amber-700 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-900/40 rounded-lg transition-colors"
            >
              Select all
            </button>
            <button
              onClick={clearSelection}
              className="px-3 py-1.5 text-xs font-medium text-amber-700 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-900/40 rounded-lg transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Select mode toggle button (when not in select mode) */}
      {!isSelectMode && canUserEdit && totalCount > 0 && (
        <div className="mb-4 flex justify-end">
          <button
            onClick={() => {
              haptic('light');
              setIsSelectMode(true);
            }}
            className="px-3 py-1.5 text-xs font-medium text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors flex items-center gap-1.5"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
            </svg>
            Select
          </button>
        </div>
      )}

      {/* Items - List View */}
      {viewMode === "list" && (
        <div className="overflow-hidden">
          {sortedItems.length === 0 ? (
            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg">
              <NoItemsEmptyState />
            </div>
          ) : aisleGroups ? (
            /* Categorized view — items grouped by category/aisle */
            <div
              ref={itemsContainerRef}
              onTouchMove={groceryTouchDrag.handleTouchMove}
              onTouchEnd={groceryTouchDrag.handleTouchEnd}
            >
              <div className="flex items-center justify-center gap-1.5 px-3 py-1.5 mb-2 text-xs text-gray-400 dark:text-gray-500">
                <span>✨</span>
                <span>Drag items between aisles to reclassify</span>
              </div>
              {aisleGroups.groups.map(({ category: aisle, items: aisleItems }, groupIndex) => (
                <div key={aisle.id} className="mb-3" data-aisle-id={aisle.id}>
                  {/* Aisle section header — highlights when dragging over */}
                  <div className={`flex items-center gap-2 px-3 py-2 rounded-t-xl border-b transition-colors duration-150 ${
                    dragOverAisleId === aisle.id && groceryTouchDrag.state.draggedId
                      ? "bg-amber-100 dark:bg-amber-900/40 border-amber-400 dark:border-amber-600 ring-2 ring-amber-400 dark:ring-amber-600"
                      : "bg-amber-50 dark:bg-gray-700 border-amber-100 dark:border-gray-600"
                  }`}>
                    <span className="text-lg">{aisle.emoji}</span>
                    <span className="font-semibold text-sm text-gray-800 dark:text-gray-200">{aisle.name}</span>
                    {canUserEdit ? (
                      <CategoryHeaderMenu
                        category={aisle}
                        itemCount={aisleItems.length}
                        isFirst={groupIndex === 0}
                        isLast={groupIndex === aisleGroups.groups.length - 1}
                        haptic={haptic}
                        onRename={(name) => renameCategoryMutation({ listId, categoryId: aisle.id, name, userDid: did })}
                        onSetEmoji={(emoji) => setCategoryEmojiMutation({ listId, categoryId: aisle.id, emoji, userDid: did })}
                        onMove={(direction) => moveCategoryMutation({ listId, categoryId: aisle.id, direction, userDid: did })}
                        onDelete={() => deleteCategoryMutation({ listId, categoryId: aisle.id, userDid: did })}
                      />
                    ) : (
                      <span className="ml-auto text-xs text-gray-400 dark:text-gray-500 tabular-nums">
                        {aisleItems.length} {aisleItems.length === 1 ? "item" : "items"}
                      </span>
                    )}
                  </div>
                  <div className="bg-white dark:bg-gray-800 rounded-b-xl shadow-lg divide-y divide-gray-100 dark:divide-gray-700">
                    {aisleItems.map((item) => {
                      const globalIndex = sortedItems.findIndex(si => si._id === item._id);
                      const hasAisleOverride = !!(item as OptimisticItem & { groceryAisle?: string }).groceryAisle;
                      return (
                        <div
                          key={item._id}
                          data-item-id={item._id}
                          className="animate-slide-up relative"
                        >
                          {hasAisleOverride && (
                            <span className="absolute top-1 right-1 z-10 text-[10px] opacity-60" title="Manually placed in this aisle">📌</span>
                          )}
                          <NestedListItem
                            item={item}
                            userDid={did}
                            legacyDid={legacyDid ?? undefined}
                            canEdit={canUserEdit}
                            isDragging={groceryTouchDrag.state.draggedId === item._id}
                            isDragOver={groceryTouchDrag.state.dragOverId === item._id}
                            isFocused={focusedIndex === globalIndex}
                            onTouchStart={groceryTouchDrag.handleTouchStart}
                            onCheck={checkItemWithStreak}
                            onUncheck={uncheckItem}
                            isSelectMode={isSelectMode}
                            isSelected={selectedIds.has(item._id)}
                            onToggleSelect={() => toggleSelection(item._id)}
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}

              {/* Add custom aisle */}
              {canUserEdit && (
                showAddAisle ? (
                  <div className="mb-3 bg-white dark:bg-gray-800 rounded-xl shadow-lg p-3">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-sm font-medium text-gray-700 dark:text-gray-300">New Aisle</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={newAisleEmoji}
                        onChange={e => setNewAisleEmoji(e.target.value)}
                        className="w-10 text-center text-lg bg-gray-100 dark:bg-gray-700 rounded-lg p-1"
                        maxLength={2}
                      />
                      <input
                        type="text"
                        value={newAisleName}
                        onChange={e => setNewAisleName(e.target.value)}
                        placeholder="Aisle name..."
                        className="flex-1 text-sm bg-gray-100 dark:bg-gray-700 rounded-lg px-3 py-2 text-gray-800 dark:text-gray-200 placeholder-gray-400"
                        autoFocus
                        onKeyDown={e => {
                          if (e.key === "Enter" && newAisleName.trim()) {
                            addCategoryMutation({ listId, name: newAisleName.trim(), emoji: newAisleEmoji || "🏷️", userDid: did });
                            setNewAisleName("");
                            setNewAisleEmoji("🏷️");
                            setShowAddAisle(false);
                          } else if (e.key === "Escape") {
                            setShowAddAisle(false);
                            setNewAisleName("");
                          }
                        }}
                      />
                      <button
                        onClick={() => {
                          if (newAisleName.trim()) {
                            addCategoryMutation({ listId, name: newAisleName.trim(), emoji: newAisleEmoji || "🏷️", userDid: did });
                            setNewAisleName("");
                            setNewAisleEmoji("🏷️");
                            setShowAddAisle(false);
                          }
                        }}
                        className="text-sm font-medium text-amber-700 dark:text-amber-400 px-2 py-1 hover:text-amber-800 dark:hover:text-amber-300"
                      >
                        Add
                      </button>
                      <button
                        onClick={() => { setShowAddAisle(false); setNewAisleName(""); }}
                        className="text-sm text-gray-400 px-1"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => setShowAddAisle(true)}
                    className="w-full mb-3 py-2 text-sm text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 flex items-center justify-center gap-1.5 rounded-xl border border-dashed border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600 transition-colors"
                  >
                    <span>＋</span>
                    <span>New Aisle</span>
                  </button>
                )
              )}

              {/* Completed section */}
              {aisleGroups.checked.length > 0 && (
                <div className="mb-3">
                  <div className="flex items-center gap-2 px-3 py-1.5 rounded-t-xl bg-gray-50 dark:bg-gray-700 border-b border-gray-100 dark:border-gray-600">
                    <span className="text-xs">✅</span>
                    <span className="font-medium text-xs text-gray-500 dark:text-gray-400">Completed</span>
                    <span className="ml-auto text-xs text-gray-400 dark:text-gray-500 tabular-nums">
                      {aisleGroups.checked.length}
                    </span>
                  </div>
                  <div className="bg-white/50 dark:bg-gray-800/50 rounded-b-xl divide-y divide-gray-100 dark:divide-gray-700/50">
                    {aisleGroups.checked.map((item) => {
                      const globalIndex = sortedItems.findIndex(si => si._id === item._id);
                      return (
                        <div
                          key={item._id}
                          data-item-id={item._id}
                        >
                          <NestedListItem
                            item={item}
                            userDid={did}
                            legacyDid={legacyDid ?? undefined}
                            canEdit={canUserEdit}
                            isDragging={false}
                            isDragOver={false}
                            isFocused={focusedIndex === globalIndex}
                            onCheck={checkItemWithStreak}
                            onUncheck={uncheckItem}
                            isSelectMode={isSelectMode}
                            isSelected={selectedIds.has(item._id)}
                            onToggleSelect={() => toggleSelection(item._id)}
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          ) : (
            /* Standard flat list view — rounded cards with collapsed Done section */
            <div
              ref={itemsContainerRef}
              onTouchMove={touchDrag.handleTouchMove}
              onTouchEnd={touchDrag.handleTouchEnd}
            >
              {/* Active (unchecked) items as rounded cards - only top-level items (no parentId) */}
              <div className="space-y-2">
                {sortedItems.filter(item => !item.checked && !item.parentId).map((item: OptimisticItem) => {
                  const globalIndex = sortedItems.findIndex(si => si._id === item._id);
                  return (
                    <div 
                      key={item._id} 
                      data-item-id={item._id}
                      className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-amber-100/60 dark:border-gray-700 overflow-hidden animate-slide-up"
                    >
                      <NestedListItem
                        item={item}
                        userDid={did}
                        legacyDid={legacyDid ?? undefined}
                        canEdit={canUserEdit}
                        isDragging={draggedItemId === item._id || touchDrag.state.draggedId === item._id}
                        isDragOver={dragOverItemId === item._id || touchDrag.state.dragOverId === item._id}
                        isFocused={focusedIndex === globalIndex}
                        onDragStart={() => handleDragStart(item._id)}
                        onDragOver={(e) => handleDragOver(e, item._id)}
                        onDragEnd={handleDragEnd}
                        onTouchStart={touchDrag.handleTouchStart}
                        onCheck={checkItemWithStreak}
                        onUncheck={uncheckItem}
                        isSelectMode={isSelectMode}
                        isSelected={selectedIds.has(item._id)}
                        onToggleSelect={() => toggleSelection(item._id)}
                        onLongPress={() => enterSelectMode(item._id)}
                      />
                    </div>
                  );
                })}
              </div>

              {/* Collapsed Done section */}
              {checkedCount > 0 && (
                <div className="mt-4">
                  <button
                    onClick={() => {
                      haptic('light');
                      setDoneCollapsed(!doneCollapsed);
                    }}
                    className="w-full flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-amber-700 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/20 rounded-xl transition-colors"
                  >
                    <svg
                      className={`w-4 h-4 transition-transform duration-200 ${doneCollapsed ? "" : "rotate-90"}`}
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                    <span>Done</span>
                    <span className="ml-1 px-2 py-0.5 bg-amber-100 dark:bg-amber-900/40 text-amber-600 dark:text-amber-400 rounded-full text-xs tabular-nums">
                      {checkedCount}
                    </span>
                  </button>

                  {!doneCollapsed && (
                    <div className="mt-1 bg-white/50 dark:bg-gray-800/50 rounded-xl border border-gray-100 dark:border-gray-700 overflow-hidden divide-y divide-gray-100 dark:divide-gray-700/50">
                      {sortedItems.filter(item => item.checked && !item.parentId).map((item: OptimisticItem) => {
                        const globalIndex = sortedItems.findIndex(si => si._id === item._id);
                        return (
                          <div
                            key={item._id}
                            data-item-id={item._id}
                          >
                            <NestedListItem
                              item={item}
                              userDid={did}
                              legacyDid={legacyDid ?? undefined}
                              canEdit={canUserEdit}
                              isDragging={draggedItemId === item._id || touchDrag.state.draggedId === item._id}
                              isDragOver={dragOverItemId === item._id || touchDrag.state.dragOverId === item._id}
                              isFocused={focusedIndex === globalIndex}
                              onDragStart={() => handleDragStart(item._id)}
                              onDragOver={(e) => handleDragOver(e, item._id)}
                              onDragEnd={handleDragEnd}
                              onTouchStart={touchDrag.handleTouchStart}
                              onCheck={checkItemWithStreak}
                              onUncheck={uncheckItem}
                              isSelectMode={isSelectMode}
                              isSelected={selectedIds.has(item._id)}
                              onToggleSelect={() => toggleSelection(item._id)}
                              onLongPress={() => enterSelectMode(item._id)}
                            />
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Add Item Input - sticky at bottom of viewport */}
      {canUserEdit && viewMode === "list" && (
        <div className="sticky bottom-0 z-10 pt-2 pb-3 mt-4 bg-gradient-to-t from-white via-white dark:from-gray-900 dark:via-gray-900 to-transparent animate-slide-up">
          <AddItemInput ref={addItemInputRef} assetDid={list.assetDid} onAddItem={addItem} />
        </div>
      )}

      {/* Items - Calendar View */}
      {viewMode === "calendar" && (
        <CalendarView
          listId={listId}
          userDid={did}
          onItemClick={(item) => {
            haptic('light');
            setSelectedCalendarItemId(item._id);
          }}
        />
      )}

      {/* Viewer notice */}
      {!canUserEdit && (
        <div className="mt-4 p-4 bg-gray-100 dark:bg-gray-800 rounded-xl text-center text-gray-500 dark:text-gray-400 text-sm flex items-center justify-center gap-2">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
          </svg>
          You have view-only access to this list.
        </div>
      )}

      {/* Modals - lazy-loaded with Suspense */}
      <Suspense fallback={null}>
        {isDeleteDialogOpen && (
          <DeleteListDialog
            list={list}
            onClose={() => setIsDeleteDialogOpen(false)}
            onDeleted={() => navigate("/d")}
          />
        )}

        {isShareModalOpen && (
          <ShareModal list={list} onClose={() => setIsShareModalOpen(false)} />
        )}

        {isPublishModalOpen && (
          <PublishModal list={list} onClose={() => setIsPublishModalOpen(false)} />
        )}

        {isRenameDialogOpen && (
          <RenameListDialog
            list={list}
            onClose={() => setIsRenameDialogOpen(false)}
          />
        )}

        {isCategoryDialogOpen && (
          <ChangeCategoryDialog
            listId={listId}
            currentCategoryId={list.categoryId}
            onClose={() => setIsCategoryDialogOpen(false)}
          />
        )}

        {isSaveTemplateModalOpen && (
          <SaveAsTemplateModal
            listId={listId}
            listName={list.name}
            onClose={() => setIsSaveTemplateModalOpen(false)}
          />
        )}

        {selectedCalendarItem && (
          <ItemDetailsModal
            item={selectedCalendarItem}
            userDid={did}
            legacyDid={legacyDid ?? undefined}
            canEdit={canUserEdit}
            onClose={() => setSelectedCalendarItemId(null)}
          />
        )}
        
        {editingItem && (
          <ItemDetailsModal
            item={editingItem}
            userDid={did}
            legacyDid={legacyDid ?? undefined}
            canEdit={canUserEdit}
            onClose={() => setEditingItemId(null)}
          />
        )}
      </Suspense>
      
      {/* Keyboard shortcuts help modal */}
      {showHelp && (
        <KeyboardShortcutsHelp
          shortcuts={shortcuts.filter(s => 
            // Only show distinct shortcuts in help (filter duplicates)
            !["ArrowUp", "ArrowDown", " ", "Enter", "Delete", "Backspace"].includes(s.key)
          )}
          onClose={() => setShowHelp(false)}
        />
      )}

      {/* Batch operations bar */}
      {canUserEdit && (
        <BatchOperations
          selectedIds={selectedIds}
          onClearSelection={clearSelection}
          userDid={did}
          legacyDid={legacyDid ?? undefined}
        />
      )}

      {/* Streak milestone celebration */}
      {celebrationMilestone !== null && (
        <StreakCelebration
          milestone={celebrationMilestone}
          onDismiss={() => setCelebrationMilestone(null)}
        />
      )}
    </div>
  );
}
