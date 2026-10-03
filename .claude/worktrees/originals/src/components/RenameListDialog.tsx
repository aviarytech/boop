/**
 * Dialog for renaming a list.
 */

import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useCurrentUser } from "../hooks/useCurrentUser";
import { useFocusTrap } from "../hooks/useFocusTrap";
import type { Doc } from "../../convex/_generated/dataModel";

interface RenameListDialogProps {
  list: Doc<"lists">;
  onClose: () => void;
}

export function RenameListDialog({ list, onClose }: RenameListDialogProps) {
  const { did, legacyDid } = useCurrentUser();
  const renameList = useMutation(api.lists.renameList);
  const [name, setName] = useState(list.name);
  const [isRenaming, setIsRenaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useFocusTrap<HTMLDivElement>({ onEscape: onClose });

  const handleRename = async () => {
    if (!did || !name.trim() || name.trim() === list.name) {
      onClose();
      return;
    }

    setIsRenaming(true);
    setError(null);

    try {
      await renameList({
        listId: list._id,
        name: name.trim(),
        userDid: did,
        legacyDid: legacyDid ?? undefined,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to rename list");
      setIsRenaming(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 animate-fade-in">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="rename-dialog-title"
        className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl max-w-sm w-full p-6 animate-slide-up"
      >
        <h3 id="rename-dialog-title" className="text-lg font-bold text-gray-900 dark:text-gray-100 mb-4">
          Rename list
        </h3>

        <label htmlFor="rename-list-input" className="sr-only">List name</label>
        <input
          id="rename-list-input"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleRename();
          }}
          autoFocus
          className="w-full px-4 py-3 bg-gray-100 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent"
          placeholder="List name"
        />

        {error && (
          <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>
        )}

        <div className="flex gap-3 mt-4">
          <button
            onClick={onClose}
            disabled={isRenaming}
            className="flex-1 px-4 py-2.5 text-sm font-medium text-gray-700 dark:text-gray-200 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-xl transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleRename}
            disabled={isRenaming || !name.trim()}
            className="flex-1 px-4 py-2.5 text-sm font-medium text-white bg-amber-500 hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl transition-colors"
          >
            {isRenaming ? "Renaming…" : "Rename"}
          </button>
        </div>
      </div>
    </div>
  );
}
