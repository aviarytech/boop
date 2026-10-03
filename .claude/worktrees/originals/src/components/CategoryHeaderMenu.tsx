/**
 * The ⋯ menu on a category section header: rename, change emoji, reorder, delete.
 *
 * Rename and emoji edit inline in the header itself rather than opening a dialog,
 * so a one-word fix costs one tap and no context switch.
 */

import { useEffect, useRef, useState } from "react";
import type { Category } from "../lib/categories";
import { OTHER_CATEGORY_ID } from "../lib/categories";

interface CategoryHeaderMenuProps {
  category: Category;
  itemCount: number;
  isFirst: boolean;
  isLast: boolean;
  onRename: (name: string) => void;
  onSetEmoji: (emoji: string) => void;
  onMove: (direction: "up" | "down") => void;
  onDelete: () => void;
  haptic: (style?: "light" | "medium" | "heavy") => void;
}

export function CategoryHeaderMenu({
  category,
  itemCount,
  isFirst,
  isLast,
  onRename,
  onSetEmoji,
  onMove,
  onDelete,
  haptic,
}: CategoryHeaderMenuProps) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<"name" | "emoji" | null>(null);
  const [draft, setDraft] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  // Other exists so items always have a home; it is not user-editable except
  // for its emoji, so it gets no menu at all.
  const isProtected = category.id === OTHER_CATEGORY_ID;

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const beginEdit = (mode: "name" | "emoji") => {
    setDraft(mode === "name" ? category.name : category.emoji);
    setEditing(mode);
    setOpen(false);
  };

  const commit = () => {
    const value = draft.trim();
    if (value) {
      if (editing === "name" && value !== category.name) onRename(value);
      if (editing === "emoji" && value !== category.emoji) onSetEmoji(value);
    }
    setEditing(null);
  };

  if (editing) {
    return (
      <input
        type="text"
        value={draft}
        autoFocus
        maxLength={editing === "emoji" ? 2 : 40}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") setEditing(null);
        }}
        aria-label={editing === "name" ? "Category name" : "Category emoji"}
        className={`${
          editing === "emoji" ? "w-12 text-center text-lg" : "flex-1 text-sm font-semibold"
        } bg-white dark:bg-gray-800 border border-amber-400 dark:border-amber-600 rounded-lg px-2 py-1 text-gray-800 dark:text-gray-200`}
      />
    );
  }

  return (
    <div ref={containerRef} className="relative ml-auto flex items-center gap-2">
      <span className="text-xs text-gray-400 dark:text-gray-500 tabular-nums">
        {itemCount} {itemCount === 1 ? "item" : "items"}
      </span>

      <button
        type="button"
        onClick={() => {
          haptic("light");
          setOpen((v) => !v);
        }}
        aria-label={`Edit ${category.name} category`}
        aria-expanded={open}
        className="p-1 -mr-1 rounded-lg text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-amber-100/60 dark:hover:bg-gray-600 transition-colors"
      >
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
          <circle cx="4" cy="10" r="1.6" />
          <circle cx="10" cy="10" r="1.6" />
          <circle cx="16" cy="10" r="1.6" />
        </svg>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-20 mt-1 w-48 overflow-hidden rounded-xl bg-white dark:bg-gray-800 shadow-xl ring-1 ring-black/5 dark:ring-white/10"
        >
          <MenuItem icon="😀" label="Change emoji" onClick={() => beginEdit("emoji")} />
          {!isProtected && <MenuItem icon="✏️" label="Rename" onClick={() => beginEdit("name")} />}
          {!isProtected && !isFirst && (
            <MenuItem
              icon="↑"
              label="Move up"
              onClick={() => {
                haptic("light");
                onMove("up");
                setOpen(false);
              }}
            />
          )}
          {!isProtected && !isLast && (
            <MenuItem
              icon="↓"
              label="Move down"
              onClick={() => {
                haptic("light");
                onMove("down");
                setOpen(false);
              }}
            />
          )}
          {!isProtected && (
            <MenuItem
              icon="🗑"
              label="Delete"
              destructive
              onClick={() => {
                haptic("medium");
                onDelete();
                setOpen(false);
              }}
            />
          )}
        </div>
      )}
    </div>
  );
}

function MenuItem({
  icon,
  label,
  onClick,
  destructive,
}: {
  icon: string;
  label: string;
  onClick: () => void;
  destructive?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={`flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm transition-colors hover:bg-gray-100 dark:hover:bg-gray-700 ${
        destructive
          ? "text-red-600 dark:text-red-400"
          : "text-gray-700 dark:text-gray-200"
      }`}
    >
      <span className="w-4 text-center">{icon}</span>
      {label}
    </button>
  );
}
