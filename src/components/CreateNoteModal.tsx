/**
 * Panel for naming a new note. Notes are uncapped, so unlike CreateListModal
 * there is no plan-limit branch; a created note opens straight into its page.
 */

import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation } from "../lib/authenticatedConvex";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { useCurrentUser } from "../hooks/useCurrentUser";
import { useSettings } from "../hooks/useSettings";
import { createNoteAsset } from "../lib/originals";
import { CategorySelector } from "./lists/CategorySelector";
import { Panel } from "./ui/Panel";

export function CreateNoteModal({ onClose }: { onClose: () => void }) {
  const { did } = useCurrentUser();
  const navigate = useNavigate();
  const { haptic } = useSettings();
  const createList = useMutation(api.lists.createList);

  const [title, setTitle] = useState("");
  const [categoryId, setCategoryId] = useState<Id<"categories"> | undefined>(undefined);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) {
      setError("Please enter a note title");
      haptic('error');
      return;
    }
    if (!did) {
      setError("No identity found");
      haptic('error');
      return;
    }

    setError(null);
    setIsCreating(true);
    haptic('medium');

    try {
      const asset = await createNoteAsset(trimmed, did);
      const listId = await createList({
        assetDid: asset.assetDid,
        celEnvelope: asset.envelope,
        name: trimmed,
        categoryId,
        createdAt: Date.now(),
        kind: "note",
      });
      haptic('success');
      navigate(`/n/${listId}`);
    } catch (err) {
      console.error("Failed to create note:", err);
      setError("Failed to create note. Please try again.");
      haptic('error');
      setIsCreating(false);
    }
  };

  const header = (
    <>
      <div className="flex items-center gap-3">
        <span className="text-2xl leading-none" aria-hidden="true">¶</span>
        <div>
          <h2 id="create-note-dialog-title" className="text-lg font-bold text-gray-900 dark:text-gray-100">
            New note
          </h2>
          <p className="text-xs text-gray-500 dark:text-gray-400">Give your note a title</p>
        </div>
      </div>
      <button
        onClick={() => { haptic('light'); onClose(); }}
        className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
        aria-label="Close"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </>
  );

  const footer = (
    <div className="px-5 py-4 flex gap-3">
      <button
        type="button"
        onClick={() => { haptic('light'); onClose(); }}
        disabled={isCreating}
        className="flex-1 px-4 py-3 text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded-xl font-medium hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50 transition-colors"
      >
        Cancel
      </button>
      <button
        type="submit"
        form="create-note-form"
        disabled={isCreating || !title.trim()}
        className="flex-1 px-4 py-3 bg-amber-500 hover:bg-amber-400 text-white rounded-xl font-semibold shadow-lg shadow-amber-500/25 disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none transition-all"
      >
        {isCreating ? "Creating..." : "Create note"}
      </button>
    </div>
  );

  return (
    <Panel isOpen onClose={onClose} header={header} footer={footer} ariaLabelledBy="create-note-dialog-title">
      <form id="create-note-form" onSubmit={handleSubmit} className="p-5 space-y-4">
        <div>
          <label htmlFor="noteTitle" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Note title
          </label>
          <input
            id="noteTitle"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g., Why boop signs every list"
            className="w-full px-4 py-3 bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100 border-2 border-gray-200 dark:border-gray-700 rounded-xl focus:outline-none focus:border-amber-500 dark:focus:border-amber-500 focus:ring-4 focus:ring-amber-500/10 transition-all disabled:opacity-50"
            disabled={isCreating}
            autoFocus
          />
        </div>

        <CategorySelector value={categoryId} onChange={setCategoryId} disabled={isCreating} />

        {error && (
          <div role="alert" className="px-4 py-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl text-red-700 dark:text-red-400 text-sm">
            {error}
          </div>
        )}
      </form>
    </Panel>
  );
}
