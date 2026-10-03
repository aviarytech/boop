/**
 * Component for a single item in a list.
 *
 * Shows checkbox, name, attribution, and remove button.
 * Features improved design, dark mode, and haptic feedback.
 * Supports notes, due dates, URLs, and recurrence.
 */

import { useState, useRef, lazy, Suspense, memo } from "react";
import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { ItemAttribution } from "./ItemAttribution";
import { useSettings } from "../hooks/useSettings";
import { useOffline } from "../hooks/useOffline";
import { queueMutation } from "../lib/offline";
import type { OptimisticItem } from "../hooks/useOptimisticItems";
import { useSubItemProgress } from "./SubItems";
import { shareItem } from "../lib/share";

// Lazy load the details modal
const ItemDetailsModal = lazy(() => import("./ItemDetailsModal").then(m => ({ default: m.ItemDetailsModal })));

interface ListItemProps {
  item: OptimisticItem;
  userDid: string;
  legacyDid?: string;
  canEdit?: boolean;
  isDragging?: boolean;
  isDragOver?: boolean;
  isFocused?: boolean;
  onDragStart?: () => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDragEnd?: () => void;
  onTouchStart?: (e: React.TouchEvent, itemId: string, element: HTMLElement) => void;
  onCheck?: (itemId: Id<"items">, checkedByDid: string, legacyDid?: string) => Promise<void>;
  onUncheck?: (itemId: Id<"items">, userDid: string, legacyDid?: string) => Promise<void>;
  // Selection mode props
  isSelectMode?: boolean;
  isSelected?: boolean;
  onToggleSelect?: () => void;
  onLongPress?: () => void;
}

export const ListItem = memo(function ListItem({
  item,
  userDid,
  legacyDid,
  canEdit: canUserEdit = true,
  isDragging = false,
  isDragOver = false,
  isFocused = false,
  onDragStart,
  onDragOver,
  onDragEnd,
  onTouchStart,
  onCheck,
  onUncheck,
  isSelectMode = false,
  isSelected = false,
  onToggleSelect,
  onLongPress,
}: ListItemProps) {
  const { haptic } = useSettings();
  const { isOnline } = useOffline();
  
  // Fallback mutations for when callbacks aren't provided
  const checkItemMutation = useMutation(api.items.checkItem);
  const uncheckItemMutation = useMutation(api.items.uncheckItem);
  const removeItem = useMutation(api.items.removeItem);

  const [isUpdating, setIsUpdating] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const itemRef = useRef<HTMLDivElement>(null);
  const longPressTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  
  // Get sub-item progress (only for top-level items)
  const subItemProgress = useSubItemProgress(item._id);
  const assigneeDid = (item as OptimisticItem & { assigneeDid?: string }).assigneeDid;

  // Long-press handling for entering select mode
  const handlePointerDown = () => {
    if (!canUserEdit || isSelectMode) return;
    longPressTimeoutRef.current = setTimeout(() => {
      onLongPress?.();
    }, 500); // 500ms long press
  };

  const handlePointerUp = () => {
    if (longPressTimeoutRef.current) {
      clearTimeout(longPressTimeoutRef.current);
      longPressTimeoutRef.current = null;
    }
  };

  const handlePointerLeave = () => {
    if (longPressTimeoutRef.current) {
      clearTimeout(longPressTimeoutRef.current);
      longPressTimeoutRef.current = null;
    }
  };
  
  // Format due date for display
  const dueDateStr = item.dueDate 
    ? new Date(item.dueDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    : null;
  
  // Check if overdue
  const isOverdue = item.dueDate && !item.checked && item.dueDate < Date.now();

  const handleToggleCheck = async () => {
    if (isUpdating) return;

    haptic(item.checked ? 'light' : 'success');
    setIsUpdating(true);

    try {
      if (item.checked) {
        if (onUncheck) {
          await onUncheck(item._id, userDid, legacyDid);
        } else {
          await uncheckItemMutation({ itemId: item._id, userDid, legacyDid });
        }
      } else {
        if (onCheck) {
          await onCheck(item._id, userDid, legacyDid);
        } else {
          await checkItemMutation({
            itemId: item._id,
            checkedByDid: userDid,
            legacyDid,
            checkedAt: Date.now(),
          });
        }
      }
    } catch (err) {
      console.error("Failed to toggle item:", err);
      haptic('error');
    } finally {
      setIsUpdating(false);
    }
  };

  const handleRemove = async () => {
    if (isUpdating) return;

    haptic('medium');
    setIsUpdating(true);

    try {
      const payload = { itemId: item._id, userDid, legacyDid };
      
      if (isOnline) {
        await removeItem(payload);
      } else {
        await queueMutation({
          type: "removeItem",
          payload,
          timestamp: Date.now(),
          retryCount: 0,
        });
      }
    } catch (err) {
      console.error("Failed to remove item:", err);
      haptic('error');
      setIsUpdating(false);
    }
  };

  const handleShare = async () => {
    haptic('light');
    
    const listUrl = `${window.location.origin}/d/${item.listId}`;
    const listName = "My List"; // We don't have the list name here, so use a generic name
    
    try {
      await shareItem(item.name, listName, listUrl);
      haptic('success');
    } catch (error) {
      console.error('Share failed:', error);
      haptic('error');
    }
  };

  return (
    <div
      ref={itemRef}
      draggable={canUserEdit && !isSelectMode}
      onDragStart={(e) => {
        if (!canUserEdit || isSelectMode) return;
        e.dataTransfer.effectAllowed = "move";
        onDragStart?.();
      }}
      onDragOver={canUserEdit && !isSelectMode ? onDragOver : undefined}
      onDragEnd={canUserEdit && !isSelectMode ? onDragEnd : undefined}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerLeave}
      onClick={isSelectMode ? onToggleSelect : undefined}
      className={`flex items-center gap-1.5 px-3 py-1 transition-all touch-manipulation ${
        isDragging 
          ? "opacity-50 bg-gray-100 dark:bg-gray-700 scale-[1.02]" 
          : "hover:bg-gray-50 dark:hover:bg-gray-700/50"
      } ${
        isDragOver 
          ? "border-t-2 border-amber-500 -mt-0.5" 
          : ""
      } ${
        item._isOptimistic 
          ? "opacity-60" 
          : ""
      } ${
        item.checked
          ? "bg-gray-50/50 dark:bg-gray-800/50"
          : ""
      } ${
        isSelected
          ? "bg-amber-50 dark:bg-amber-900/30 ring-2 ring-amber-400 dark:ring-amber-600"
          : ""
      } ${
        isFocused && !isSelected
          ? "bg-amber-50 dark:bg-amber-900/20 ring-2 ring-amber-300 dark:ring-amber-700"
          : ""
      } ${
        isSelectMode
          ? "cursor-pointer"
          : ""
      }`}
    >
      {/* Selection checkbox - show in select mode */}
      {isSelectMode && canUserEdit && (
        <div
          className={`flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center transition-all -ml-2`}
          role="checkbox"
          aria-checked={isSelected}
          aria-label={`Select ${item.name}`}
        >
          <div className={`w-6 h-6 rounded-full flex items-center justify-center transition-all ${
            isSelected
              ? "bg-[#6b3cff] text-white"
              : "bg-stone-200 dark:bg-stone-600"
          }`}>
            {isSelected && (
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                <path
                  fillRule="evenodd"
                  d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                  clipRule="evenodd"
                />
              </svg>
            )}
          </div>
        </div>
      )}

      {/* Drag handle - only show if user can edit and not in select mode */}
      {canUserEdit && !isSelectMode && (
        <button
          className="flex-shrink-0 w-8 h-8 flex items-center justify-center text-gray-300 dark:text-gray-600 cursor-grab active:cursor-grabbing hover:text-gray-400 dark:hover:text-gray-500 transition-colors touch-none select-none -ml-2"
          aria-label="Drag to reorder"
          onTouchStart={(e) => {
            if (itemRef.current && onTouchStart) {
              onTouchStart(e, item._id, itemRef.current);
            }
          }}
          tabIndex={-1}
        >
          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
            <path d="M7 2a2 2 0 1 0 .001 4.001A2 2 0 0 0 7 2zm0 6a2 2 0 1 0 .001 4.001A2 2 0 0 0 7 8zm0 6a2 2 0 1 0 .001 4.001A2 2 0 0 0 7 14zm6-8a2 2 0 1 0-.001-4.001A2 2 0 0 0 13 6zm0 2a2 2 0 1 0 .001 4.001A2 2 0 0 0 13 8zm0 6a2 2 0 1 0 .001 4.001A2 2 0 0 0 13 14z" />
          </svg>
        </button>
      )}

      {/* Checkbox - larger touch target (hidden in select mode) */}
      {!isSelectMode && (canUserEdit ? (
        <button
          onClick={(e) => {
            e.stopPropagation();
            handleToggleCheck();
          }}
          disabled={isUpdating}
          className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center transition-all active:scale-90 disabled:opacity-50 -ml-2`}
          aria-label={item.checked ? `Uncheck ${item.name}` : `Check ${item.name}`}
        >
          <div
            className={`w-5 h-5 rounded-full flex items-center justify-center transition-all ${
              item.checked
                ? "bg-[#6b3cff] text-white shadow-sm shadow-[#6b3cff]/30"
                : "bg-transparent border-[1.6px] border-stone-300 dark:border-stone-500 hover:border-[#6b3cff] dark:hover:border-[#9b74ff]"
            }`}
          >
            {item.checked && (
              <svg className="w-3 h-3" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                <path
                  d="M2.5 6.5l2.5 2.5 5-6"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            )}
          </div>
        </button>
      ) : (
        // Read-only checkbox display for viewers
        <div
          className={`flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center ${
            item.checked
              ? "bg-[#6b3cff] text-white"
              : "border-[1.6px] border-stone-300 dark:border-stone-500"
          }`}
          role="checkbox"
          aria-checked={item.checked}
          aria-label={`${item.name} is ${item.checked ? 'checked' : 'unchecked'}`}
        >
          {item.checked && (
            <svg className="w-3 h-3" viewBox="0 0 12 12" fill="none" aria-hidden="true">
              <path
                d="M2.5 6.5l2.5 2.5 5-6"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          )}
        </div>
      ))}

      {/* Item content - clickable to open details (or toggle selection in select mode) */}
      <div
        onClick={(e) => {
          e.stopPropagation();
          if (isSelectMode) {
            return;
          }
          haptic('selection');
          setShowDetails(true);
        }}
        className={`flex-1 min-w-0 text-left rounded px-1 -mx-1 transition-colors ${
          isSelectMode ? "" : "hover:bg-gray-50 dark:hover:bg-gray-700/30 cursor-pointer"
        }`}
      >
        <div className="flex items-center gap-1.5">
          {/* Priority indicator */}
          {item.priority && !item.checked && (
            <span 
              className={`flex-shrink-0 w-2 h-2 rounded-full ${
                item.priority === "high" ? "bg-red-500" :
                item.priority === "medium" ? "bg-yellow-500" :
                "bg-amber-500"
              }`}
              role="img"
              aria-label={`${item.priority} priority`}
            />
          )}
          <p
            className={`text-xs text-gray-900 dark:text-gray-100 transition-all truncate ${
              item.checked 
                ? "line-through text-gray-400 dark:text-gray-500" 
                : ""
            }`}
          >
            {item.name}
          </p>
          {/* Indicators for extras */}
          {item.url && (
            <span className="text-amber-600 flex-shrink-0 inline-flex items-center text-xs leading-none" role="img" aria-label="Has link">
              🔗
              <span className="sr-only">Link attached</span>
            </span>
          )}
          {item.recurrence && (
            <span 
              className="text-purple-500 flex-shrink-0 inline-flex items-center text-[10px] leading-none gap-0.5 px-1 py-0.5 bg-purple-50 dark:bg-purple-900/20 rounded" 
              role="img" 
              aria-label={`Repeats every ${item.recurrence.interval && item.recurrence.interval > 1 ? `${item.recurrence.interval} ` : ""}${item.recurrence.frequency.replace("ly", item.recurrence.interval && item.recurrence.interval > 1 ? "s" : "")}`}
              title={`Repeats every ${item.recurrence.interval && item.recurrence.interval > 1 ? `${item.recurrence.interval} ` : ""}${item.recurrence.frequency === "daily" ? (item.recurrence.interval && item.recurrence.interval > 1 ? "days" : "day") : item.recurrence.frequency === "weekly" ? (item.recurrence.interval && item.recurrence.interval > 1 ? "weeks" : "week") : (item.recurrence.interval && item.recurrence.interval > 1 ? "months" : "month")}`}
            >
              🔁
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <ItemAttribution item={item} />
          {/* Due date badge */}
          {dueDateStr && (
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full flex-shrink-0 inline-flex items-center gap-0.5 ${
              isOverdue 
                ? 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400'
                : 'bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400'
            }`}>
              <span className="leading-none">📅</span> {dueDateStr}
            </span>
          )}
          {/* Notes indicator */}
          {item.description && (
            <span className="text-[10px] text-gray-400 flex-shrink-0 inline-flex items-center leading-none" title="Has notes">📝</span>
          )}
          {/* Assignee indicator */}
          {assigneeDid && (
            <span
              className="text-[10px] px-1.5 py-0.5 rounded-full flex-shrink-0 inline-flex items-center gap-0.5 bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400"
              title={`Assigned to ${assigneeDid}`}
            >
              <span className="leading-none">👤</span>
              {assigneeDid === userDid ? "You" : `${assigneeDid.slice(0, 6)}…`}
            </span>
          )}
          {/* Attachments indicator */}
          {item.attachments && item.attachments.length > 0 && (
            <span className="text-[10px] text-gray-400 flex-shrink-0 inline-flex items-center gap-0.5" title={`${item.attachments.length} attachment${item.attachments.length > 1 ? 's' : ''}`}>
              <span className="leading-none">📎</span> {item.attachments.length}
            </span>
          )}
          {/* Sub-items indicator */}
          {subItemProgress && (
            <span 
              className={`text-[10px] px-1.5 py-0.5 rounded-full flex-shrink-0 inline-flex items-center gap-0.5 ${
                subItemProgress.checked === subItemProgress.total
                  ? 'bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400'
                  : 'bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400'
              }`}
              title={`${subItemProgress.checked} of ${subItemProgress.total} sub-items done`}
            >
              <span className="leading-none">📦</span> {subItemProgress.checked}/{subItemProgress.total}
            </span>
          )}
        </div>
      </div>

      {/* Share button - only show if not in select mode */}
      {!isSelectMode && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            handleShare();
          }}
          className="flex-shrink-0 w-8 h-8 flex items-center justify-center text-gray-300 dark:text-gray-600 hover:text-amber-500 dark:hover:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/20 rounded-lg transition-all active:scale-90"
          aria-label="Share item"
        >
          <svg
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z"
            />
          </svg>
        </button>
      )}

      {/* Remove button - only show if user can edit and not in select mode */}
      {canUserEdit && !isSelectMode && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            handleRemove();
          }}
          disabled={isUpdating}
          className="flex-shrink-0 w-8 h-8 flex items-center justify-center text-gray-300 dark:text-gray-600 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg disabled:opacity-50 transition-all active:scale-90 -mr-2"
          aria-label={`Remove ${item.name}`}
        >
          <svg
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      )}

      {/* Details Modal */}
      {showDetails && (
        <Suspense fallback={null}>
          <ItemDetailsModal
            item={item}
            userDid={userDid}
            legacyDid={legacyDid}
            canEdit={canUserEdit}
            onClose={() => setShowDetails(false)}
          />
        </Suspense>
      )}
    </div>
  );
});
