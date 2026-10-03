/**
 * Sub-items component for creating nested checklist items within a parent item.
 * Each sub-item has its own checkbox that can be checked off independently.
 */

import { useState, useRef } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id, Doc } from "../../convex/_generated/dataModel";
import { useSettings } from "../hooks/useSettings";

/**
 * Helper to check if an ID is a temporary optimistic ID (not yet persisted).
 * Temp IDs are strings like "temp-1770491397213" used for optimistic UI.
 */
function isTempId(id: string): boolean {
  return typeof id === "string" && id.startsWith("temp-");
}

interface SubItemsProps {
  parentId: Id<"items"> | string; // Can be temp ID for optimistic items
  listId: Id<"lists">;
  userDid: string;
  legacyDid?: string;
  canEdit: boolean;
}

export function SubItems({
  parentId,
  listId,
  userDid,
  legacyDid,
  canEdit,
}: SubItemsProps) {
  const { haptic } = useSettings();
  const [newItemName, setNewItemName] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [showInput, setShowInput] = useState(false);
  const subItemInputRef = useRef<HTMLInputElement>(null);

  // Skip query for temporary IDs (optimistic items not yet persisted)
  const isTemp = isTempId(parentId as string);
  
  // Fetch sub-items for this parent (skip for temp IDs)
  const subItems = useQuery(
    api.items.getSubItems,
    isTemp ? "skip" : { parentId: parentId as Id<"items"> }
  ) ?? [];
  
  // Mutations
  const addItem = useMutation(api.items.addItem);
  const checkItem = useMutation(api.items.checkItem);
  const uncheckItem = useMutation(api.items.uncheckItem);
  const removeItem = useMutation(api.items.removeItem);

  const handleAddSubItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newItemName.trim() || !canEdit || isAdding) return;
    
    // Can't add sub-items to a temp parent (not yet persisted)
    if (isTemp) return;
    
    haptic("medium");
    setIsAdding(true);

    try {
      await addItem({
        listId,
        name: newItemName.trim(),
        createdByDid: userDid,
        legacyDid,
        createdAt: Date.now(),
        parentId: parentId as Id<"items">,
      });
      haptic("success");
      setNewItemName("");
      // Keep input open for adding more items
      // Use double requestAnimationFrame to ensure focus works after React re-render
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          subItemInputRef.current?.focus();
        });
      });
    } catch (err) {
      console.error("Failed to add sub-item:", err);
      haptic("error");
    } finally {
      setIsAdding(false);
    }
  };

  const handleToggleCheck = async (item: Doc<"items">) => {
    haptic(item.checked ? "light" : "success");
    
    try {
      if (item.checked) {
        await uncheckItem({
          itemId: item._id,
          userDid,
          legacyDid,
        });
      } else {
        await checkItem({
          itemId: item._id,
          checkedByDid: userDid,
          legacyDid,
          checkedAt: Date.now(),
        });
      }
    } catch (err) {
      console.error("Failed to toggle sub-item:", err);
      haptic("error");
    }
  };

  const handleRemove = async (itemId: Id<"items">) => {
    haptic("medium");
    
    try {
      await removeItem({
        itemId,
        userDid,
        legacyDid,
      });
    } catch (err) {
      console.error("Failed to remove sub-item:", err);
      haptic("error");
    }
  };

  // Sort: unchecked first, then by order/createdAt
  const sortedItems = [...subItems].sort((a, b) => {
    // Unchecked items first
    if (a.checked !== b.checked) return a.checked ? 1 : -1;
    // Then by order
    const orderA = a.order ?? a.createdAt;
    const orderB = b.order ?? b.createdAt;
    return orderA - orderB;
  });

  const checkedCount = subItems.filter((i) => i.checked).length;
  const totalCount = subItems.length;

  return (
    <div className="space-y-2">
      {/* Progress indicator if there are sub-items */}
      {totalCount > 0 && (
        <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
          <div className="flex-1 h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-green-500 to-emerald-600 rounded-full transition-all duration-300"
              style={{ width: `${totalCount > 0 ? (checkedCount / totalCount) * 100 : 0}%` }}
            />
          </div>
          <span className="flex-shrink-0">
            {checkedCount}/{totalCount}
          </span>
        </div>
      )}

      {/* Sub-items list */}
      <div className="space-y-1">
        {sortedItems.map((item) => (
          <div
            key={item._id}
            className={`flex items-center gap-2 px-2 py-1.5 rounded-lg transition-colors ${
              item.checked
                ? "bg-gray-50 dark:bg-gray-800/50"
                : "bg-gray-50 dark:bg-gray-900 hover:bg-gray-100 dark:hover:bg-gray-800"
            }`}
          >
            {/* Checkbox */}
            {canEdit ? (
              <button
                onClick={() => handleToggleCheck(item)}
                className={`flex-shrink-0 w-4 h-4 rounded flex items-center justify-center transition-all active:scale-90 ${
                  item.checked
                    ? "bg-gradient-to-br from-green-500 to-emerald-600 text-white"
                    : "bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 hover:border-gray-400 dark:hover:border-gray-500"
                }`}
                aria-label={item.checked ? "Uncheck sub-item" : "Check sub-item"}
              >
                {item.checked && (
                  <svg className="w-2.5 h-2.5" fill="currentColor" viewBox="0 0 20 20">
                    <path
                      fillRule="evenodd"
                      d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                      clipRule="evenodd"
                    />
                  </svg>
                )}
              </button>
            ) : (
              <div
                className={`flex-shrink-0 w-4 h-4 rounded flex items-center justify-center ${
                  item.checked
                    ? "bg-gradient-to-br from-green-500 to-emerald-600 text-white"
                    : "bg-gray-100 dark:bg-gray-700"
                }`}
              >
                {item.checked && (
                  <svg className="w-2.5 h-2.5" fill="currentColor" viewBox="0 0 20 20">
                    <path
                      fillRule="evenodd"
                      d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                      clipRule="evenodd"
                    />
                  </svg>
                )}
              </div>
            )}

            {/* Item name */}
            <span
              className={`flex-1 text-xs transition-all ${
                item.checked
                  ? "line-through text-gray-400 dark:text-gray-500"
                  : "text-gray-700 dark:text-gray-300"
              }`}
            >
              {item.name}
            </span>

            {/* Remove button */}
            {canEdit && (
              <button
                onClick={() => handleRemove(item._id)}
                className="flex-shrink-0 w-5 h-5 flex items-center justify-center text-gray-300 dark:text-gray-600 hover:text-red-500 dark:hover:text-red-400 rounded transition-colors"
                aria-label="Remove sub-item"
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        ))}
      </div>

      {/* Add new sub-item */}
      {canEdit && (
        <>
          {showInput ? (
            <form onSubmit={handleAddSubItem} className="flex items-center gap-2">
              <input
                ref={subItemInputRef}
                type="text"
                value={newItemName}
                onChange={(e) => setNewItemName(e.target.value)}
                placeholder="Add sub-item..."
                autoFocus
                disabled={isAdding}
                className="flex-1 px-3 py-1.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-xs text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-amber-500 disabled:opacity-50"
                onBlur={() => {
                  // Close input if empty after blur
                  if (!newItemName.trim()) {
                    setTimeout(() => setShowInput(false), 200);
                  }
                }}
              />
              <button
                type="submit"
                disabled={isAdding || !newItemName.trim()}
                className="flex-shrink-0 px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white text-xs font-medium rounded-lg transition-colors disabled:opacity-50"
              >
                {isAdding ? "..." : "Add"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowInput(false);
                  setNewItemName("");
                }}
                className="flex-shrink-0 px-2 py-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-xs transition-colors"
              >
                Cancel
              </button>
            </form>
          ) : (
            <button
              onClick={() => {
                haptic("light");
                setShowInput(true);
              }}
              className="flex items-center gap-1.5 px-2 py-1.5 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Add sub-item
            </button>
          )}
        </>
      )}

      {/* Empty state for viewers */}
      {!canEdit && totalCount === 0 && (
        <p className="text-xs text-gray-400 dark:text-gray-500 italic">No sub-items</p>
      )}
    </div>
  );
}

/**
 * Helper hook to get sub-item progress for an item.
 * Used by ListItem to show progress indicator.
 * 
 * Skips the query for temp IDs (optimistic items not yet persisted)
 * to avoid Convex validation errors.
 */
export function useSubItemProgress(itemId: Id<"items"> | string) {
  // Skip query for temporary IDs - they don't exist in DB yet
  const shouldSkip = isTempId(itemId as string);
  const subItems = useQuery(
    api.items.getSubItems,
    shouldSkip ? "skip" : { parentId: itemId as Id<"items"> }
  );
  
  if (!subItems || subItems.length === 0) {
    return null;
  }
  
  const checked = subItems.filter((i) => i.checked).length;
  const total = subItems.length;
  
  return { checked, total };
}
