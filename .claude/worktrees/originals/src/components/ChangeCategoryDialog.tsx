/**
 * Dialog for changing the category of a list.
 */

import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { useCurrentUser } from "../hooks/useCurrentUser";
import { CategorySelector } from "./lists/CategorySelector";

interface ChangeCategoryDialogProps {
  listId: Id<"lists">;
  currentCategoryId?: Id<"categories">;
  onClose: () => void;
}

export function ChangeCategoryDialog({
  listId,
  currentCategoryId,
  onClose,
}: ChangeCategoryDialogProps) {
  const { did, legacyDid } = useCurrentUser();
  const updateCategory = useMutation(api.lists.updateListCategory);
  const [categoryId, setCategoryId] = useState<Id<"categories"> | undefined>(currentCategoryId);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    if (!did) return;
    setSaving(true);
    setError(null);
    try {
      await updateCategory({
        listId,
        categoryId,
        userDid: did,
        legacyDid: legacyDid ?? undefined,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update category");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-sm p-6 animate-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
          Change Category
        </h2>

        <CategorySelector value={categoryId} onChange={setCategoryId} />

        {error && (
          <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>
        )}

        <div className="flex justify-end gap-3 mt-6">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 text-sm text-white bg-amber-600 rounded-lg hover:bg-amber-500 disabled:opacity-50 transition-all"
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
