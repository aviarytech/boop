/**
 * Modal for managing categories.
 *
 * Allows creating, renaming, and deleting categories.
 * Shows list counts per category.
 */

import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Doc, Id } from "../../../convex/_generated/dataModel";
import { useCategories } from "../../hooks/useCategories";
import { useCurrentUser } from "../../hooks/useCurrentUser";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { ConfirmDialog } from "../ConfirmDialog";

interface CategoryManagerProps {
  onClose: () => void;
}

export function CategoryManager({ onClose }: CategoryManagerProps) {
  const { did, legacyDid } = useCurrentUser();
  const { categories, createCategory, renameCategory, deleteCategory } =
    useCategories();
  const dialogRef = useFocusTrap<HTMLDivElement>({ onEscape: onClose });
  const [newCategoryName, setNewCategoryName] = useState("");
  const [editingId, setEditingId] = useState<Id<"categories"> | null>(null);
  const [editingName, setEditingName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  // Confirmation dialog state for category deletion
  const [confirmDeleteId, setConfirmDeleteId] = useState<Id<"categories"> | null>(null);

  // Get lists to count per category
  const lists = useQuery(
    api.lists.getUserLists,
    did ? { userDid: did, legacyDid: legacyDid ?? undefined } : "skip"
  );

  const getListCountForCategory = (categoryId: Id<"categories">) => {
    if (!lists) return 0;
    return lists.filter((list: Doc<"lists">) => list.categoryId === categoryId)
      .length;
  };

  const getUncategorizedCount = () => {
    if (!lists) return 0;
    return lists.filter((list: Doc<"lists">) => !list.categoryId).length;
  };

  const handleCreateCategory = async () => {
    const trimmedName = newCategoryName.trim();
    if (!trimmedName) {
      setError("Please enter a category name");
      return;
    }

    setIsCreating(true);
    setError(null);

    try {
      await createCategory(trimmedName);
      setNewCategoryName("");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to create category"
      );
    } finally {
      setIsCreating(false);
    }
  };

  const handleStartEdit = (category: Doc<"categories">) => {
    setEditingId(category._id);
    setEditingName(category.name);
    setError(null);
  };

  const handleSaveEdit = async () => {
    if (!editingId) return;

    const trimmedName = editingName.trim();
    if (!trimmedName) {
      setError("Category name cannot be empty");
      return;
    }

    try {
      await renameCategory(editingId, trimmedName);
      setEditingId(null);
      setEditingName("");
      setError(null);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to rename category"
      );
    }
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditingName("");
    setError(null);
  };

  const handleDeleteCategory = (categoryId: Id<"categories">) => {
    setConfirmDeleteId(categoryId);
  };

  const handleConfirmDelete = async () => {
    if (!confirmDeleteId) return;

    try {
      await deleteCategory(confirmDeleteId);
      setConfirmDeleteId(null);
      setError(null);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to delete category"
      );
      throw err; // Re-throw so ConfirmDialog shows error
    }
  };

  const getDeleteConfirmMessage = () => {
    if (!confirmDeleteId) return "";
    const listCount = getListCountForCategory(confirmDeleteId);
    return listCount > 0
      ? `This category contains ${listCount} list${listCount === 1 ? "" : "s"}. They will be moved to Uncategorized. Delete anyway?`
      : "Delete this category?";
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="category-dialog-title"
        className="bg-white rounded-lg shadow-xl max-w-md w-full p-6 max-h-[80vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between mb-4">
          <h2 id="category-dialog-title" className="text-xl font-bold text-gray-900">Manage Categories</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
          >
            <svg
              className="w-6 h-6"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md text-sm text-red-600">
            {error}
          </div>
        )}

        {/* Create new category */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-1">
            New Category
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={newCategoryName}
              onChange={(e) => setNewCategoryName(e.target.value)}
              placeholder="Category name"
              className="flex-1 px-3 py-2 text-gray-900 bg-white border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleCreateCategory();
                }
              }}
              disabled={isCreating}
            />
            <button
              onClick={handleCreateCategory}
              disabled={isCreating || !newCategoryName.trim()}
              className="px-4 py-2 bg-blue-600 text-white rounded-md font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Add
            </button>
          </div>
        </div>

        {/* Category list */}
        <div className="space-y-2">
          <h3 className="text-sm font-medium text-gray-700">Your Categories</h3>

          {categories.length === 0 ? (
            <p className="text-sm text-gray-500 py-4 text-center">
              No categories yet. Create one above.
            </p>
          ) : (
            <ul className="divide-y divide-gray-200">
              {categories.map((category) => (
                <li key={category._id} className="py-3">
                  {editingId === category._id ? (
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={editingName}
                        onChange={(e) => setEditingName(e.target.value)}
                        className="flex-1 px-3 py-1.5 text-gray-900 bg-white border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            handleSaveEdit();
                          } else if (e.key === "Escape") {
                            handleCancelEdit();
                          }
                        }}
                      />
                      <button
                        onClick={handleSaveEdit}
                        className="px-3 py-1.5 text-sm text-white bg-blue-600 rounded-md hover:bg-blue-700"
                      >
                        Save
                      </button>
                      <button
                        onClick={handleCancelEdit}
                        className="px-3 py-1.5 text-sm text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="font-medium text-gray-900">
                          {category.name}
                        </span>
                        <span className="ml-2 text-sm text-gray-500">
                          ({getListCountForCategory(category._id)} list
                          {getListCountForCategory(category._id) === 1
                            ? ""
                            : "s"}
                          )
                        </span>
                      </div>
                      <div className="flex gap-1">
                        <button
                          onClick={() => handleStartEdit(category)}
                          className="p-1.5 text-gray-400 hover:text-gray-600 rounded"
                          title="Rename"
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
                              d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
                            />
                          </svg>
                        </button>
                        <button
                          onClick={() => handleDeleteCategory(category._id)}
                          className="p-1.5 text-gray-400 hover:text-red-600 rounded"
                          title="Delete"
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
                              d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                            />
                          </svg>
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}

          {/* Uncategorized info */}
          <div className="pt-4 mt-4 border-t border-gray-200">
            <div className="flex items-center justify-between text-sm text-gray-500">
              <span>Uncategorized</span>
              <span>
                {getUncategorizedCount()} list
                {getUncategorizedCount() === 1 ? "" : "s"}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Delete category confirmation dialog */}
      {confirmDeleteId && (
        <ConfirmDialog
          title="Delete Category"
          message={getDeleteConfirmMessage()}
          confirmLabel="Delete"
          confirmVariant="danger"
          onConfirm={handleConfirmDelete}
          onCancel={() => setConfirmDeleteId(null)}
        />
      )}
    </div>
  );
}
