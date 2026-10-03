/**
 * Confirmation dialog for deleting a list.
 */

import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useCurrentUser } from "../hooks/useCurrentUser";
import { useFocusTrap } from "../hooks/useFocusTrap";
import type { Doc } from "../../convex/_generated/dataModel";

interface DeleteListDialogProps {
  list: Doc<"lists">;
  onClose: () => void;
  onDeleted: () => void;
}

export function DeleteListDialog({ list, onClose, onDeleted }: DeleteListDialogProps) {
  const { did, legacyDid } = useCurrentUser();
  const deleteList = useMutation(api.lists.deleteList);
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useFocusTrap<HTMLDivElement>({ onEscape: onClose });

  const handleDelete = async () => {
    if (!did) return;

    setIsDeleting(true);
    setError(null);

    try {
      // Pass both current and legacy DID for migrated users
      await deleteList({
        listId: list._id,
        userDid: did,
        legacyDid: legacyDid ?? undefined,
      });
      onDeleted();
    } catch (err) {
      console.error("Failed to delete list:", err);
      setError("Failed to delete list. Please try again.");
      setIsDeleting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="delete-dialog-title"
        aria-describedby="delete-dialog-description"
        className="bg-white rounded-lg shadow-xl max-w-md w-full p-6"
      >
        <h2 id="delete-dialog-title" className="text-xl font-bold text-gray-900 mb-2">Delete List</h2>
        <p id="delete-dialog-description" className="text-gray-600 mb-4">
          Are you sure you want to delete "{list.name}"? This will permanently delete the list and all its items. This action cannot be undone.
        </p>

        {error && (
          <p className="mb-4 text-sm text-red-600">{error}</p>
        )}

        <div className="flex gap-3 justify-end">
          <button
            type="button"
            onClick={onClose}
            disabled={isDeleting}
            className="px-4 py-2 text-gray-700 bg-gray-100 rounded-md font-medium hover:bg-gray-200 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={isDeleting}
            className="px-4 py-2 bg-red-600 text-white rounded-md font-medium hover:bg-red-700 disabled:opacity-50"
          >
            {isDeleting ? "Deleting..." : "Delete"}
          </button>
        </div>
      </div>
    </div>
  );
}
