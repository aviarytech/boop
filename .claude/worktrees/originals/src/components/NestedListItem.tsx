/**
 * NestedListItem - renders an item and its subtasks recursively.
 * Supports 2 levels of nesting with collapse/expand functionality.
 */

import { useState, useCallback, useMemo } from "react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { ListItem } from "./ListItem";
import type { OptimisticItem } from "../hooks/useOptimisticItems";
import { useSettings } from "../hooks/useSettings";

interface NestedListItemProps {
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
  isSelectMode?: boolean;
  isSelected?: boolean;
  onToggleSelect?: () => void;
  onLongPress?: () => void;
  depth?: number; // Track nesting depth (0 = top level, 1 = first level subtask, etc.)
  maxDepth?: number; // Maximum allowed nesting depth
  onPromote?: (itemId: Id<"items">) => void;
  onDemote?: (itemId: Id<"items">) => void;
  onIndent?: (itemId: Id<"items">) => void;
  onOutdent?: (itemId: Id<"items">) => void;
}

export function NestedListItem({
  item,
  userDid,
  legacyDid,
  canEdit = true,
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
  depth = 0,
  maxDepth = 2,
  onPromote,
  onDemote,
  onIndent,
  onOutdent,
}: NestedListItemProps) {
  const { haptic } = useSettings();
  const [isExpanded, setIsExpanded] = useState(true);

  // Fetch subtasks for this item (skip for optimistic temp IDs)
  const isTempItem = typeof item._id === "string" && (item._id as string).startsWith("temp-");
  const subItems = useQuery(
    api.items.getSubItems,
    isTempItem ? "skip" : { parentId: item._id }
  ) ?? [];

  // Sort subtasks: unchecked first, then by order/createdAt
  const sortedSubItems = useMemo(() => {
    return [...subItems].sort((a, b) => {
      if (a.checked !== b.checked) return a.checked ? 1 : -1;
      const orderA = a.order ?? a.createdAt;
      const orderB = b.order ?? b.createdAt;
      return orderA - orderB;
    });
  }, [subItems]);

  // Calculate progress
  const totalSubItems = subItems.length;
  const checkedSubItems = subItems.filter(i => i.checked).length;
  const hasSubItems = totalSubItems > 0;

  const toggleExpand = useCallback(() => {
    haptic('light');
    setIsExpanded(!isExpanded);
  }, [isExpanded, haptic]);

  // Indentation based on depth
  const indentClass = depth === 0 ? '' : depth === 1 ? 'ml-6' : 'ml-12';

  return (
    <div className={`${indentClass} transition-all`}>
      {/* Main item with expand/collapse button if it has subtasks */}
      <div className="flex items-stretch gap-0 relative">
        {/* Expand/collapse button for items with subtasks */}
        {hasSubItems && depth < maxDepth && (
          <button
            onClick={toggleExpand}
            className="flex-shrink-0 w-6 flex items-center justify-center text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors z-10"
            aria-label={isExpanded ? "Collapse subtasks" : "Expand subtasks"}
          >
            <svg
              className={`w-3 h-3 transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        )}

        {/* Spacer if no subtasks */}
        {(!hasSubItems || depth >= maxDepth) && <div className="w-6" />}

        {/* The list item itself */}
        <div className="flex-1 min-w-0">
          <ListItem
            item={item}
            userDid={userDid}
            legacyDid={legacyDid}
            canEdit={canEdit}
            isDragging={isDragging}
            isDragOver={isDragOver}
            isFocused={isFocused}
            onDragStart={onDragStart}
            onDragOver={onDragOver}
            onDragEnd={onDragEnd}
            onTouchStart={onTouchStart}
            onCheck={onCheck}
            onUncheck={onUncheck}
            isSelectMode={isSelectMode}
            isSelected={isSelected}
            onToggleSelect={onToggleSelect}
            onLongPress={onLongPress}
          />

          {/* Show progress indicator if has subtasks */}
          {hasSubItems && (
            <div className="flex items-center gap-2 px-3 pb-0.5 text-xs">
              <div className="flex-1 h-1 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-purple-500 to-violet-600 rounded-full transition-all duration-300"
                  style={{ width: `${totalSubItems > 0 ? (checkedSubItems / totalSubItems) * 100 : 0}%` }}
                />
              </div>
              <span className="text-gray-500 dark:text-gray-400 flex-shrink-0 tabular-nums">
                {checkedSubItems}/{totalSubItems}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Subtasks (recursive, only if expanded and within depth limit) */}
      {hasSubItems && isExpanded && depth < maxDepth && (
        <div className="space-y-0">
          {sortedSubItems.map((subItem) => (
            <NestedListItem
              key={subItem._id}
              item={subItem as OptimisticItem}
              userDid={userDid}
              legacyDid={legacyDid}
              canEdit={canEdit}
              onCheck={onCheck}
              onUncheck={onUncheck}
              isSelectMode={isSelectMode}
              depth={depth + 1}
              maxDepth={maxDepth}
              onPromote={onPromote}
              onDemote={onDemote}
              onIndent={onIndent}
              onOutdent={onOutdent}
            />
          ))}
        </div>
      )}
    </div>
  );
}
