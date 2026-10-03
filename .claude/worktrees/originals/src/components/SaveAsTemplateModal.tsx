/**
 * Panel for saving the current list as a template.
 * Uses Panel component for slide-up drawer experience.
 */

import { useState, type FormEvent } from "react";
import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { useCurrentUser } from "../hooks/useCurrentUser";
import { useSettings } from "../hooks/useSettings";
import { Panel } from "./ui/Panel";

interface SaveAsTemplateModalProps {
  listId: Id<"lists">;
  listName: string;
  onClose: () => void;
  onSuccess?: () => void;
}

export function SaveAsTemplateModal({ listId, listName, onClose, onSuccess }: SaveAsTemplateModalProps) {
  const { did } = useCurrentUser();
  const { haptic } = useSettings();

  const [name, setName] = useState(`${listName} Template`);
  const [description, setDescription] = useState("");
  const [isPublic, setIsPublic] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const createFromList = useMutation(api.templates.createFromList);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();

    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("Please enter a template name");
      haptic('error');
      return;
    }

    if (!did) {
      setError("No identity found");
      haptic('error');
      return;
    }

    setError(null);
    setIsSaving(true);
    haptic('medium');

    try {
      await createFromList({
        listId,
        templateName: trimmedName,
        description: description.trim() || undefined,
        isPublic,
        userDid: did,
      });

      haptic('success');
      setSuccess(true);
      
      // Auto-close after short delay
      setTimeout(() => {
        onSuccess?.();
        onClose();
      }, 1500);
    } catch (err) {
      console.error("Failed to save template:", err);
      setError("Failed to save template. Please try again.");
      haptic('error');
      setIsSaving(false);
    }
  };

  const header = (
    <>
      <div className="flex items-center gap-3">
        <span className="text-2xl leading-none">📁</span>
        <div>
          <h2 id="save-template-title" className="text-lg font-bold text-gray-900 dark:text-gray-100">
            Save as Template
          </h2>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Reuse this list structure later
          </p>
        </div>
      </div>
      <button
        onClick={() => {
          haptic('light');
          onClose();
        }}
        className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
        aria-label="Close"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </>
  );

  const footer = !success ? (
    <div className="px-5 py-4 flex gap-3">
      <button
        type="button"
        onClick={() => {
          haptic('light');
          onClose();
        }}
        disabled={isSaving}
        className="flex-1 px-4 py-3 text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded-xl font-medium hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50 transition-colors"
      >
        Cancel
      </button>
      <button
        type="submit"
        form="save-template-form"
        disabled={isSaving || !name.trim()}
        className="flex-1 px-4 py-3 bg-amber-500 hover:bg-amber-400 text-white rounded-xl font-semibold shadow-lg shadow-amber-500/25 disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none transition-all"
      >
        {isSaving ? (
          <span className="flex items-center justify-center gap-2">
            <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            Saving...
          </span>
        ) : (
          "Save Template"
        )}
      </button>
    </div>
  ) : undefined;

  return (
    <Panel
      isOpen={true}
      onClose={onClose}
      header={header}
      footer={footer}
      ariaLabelledBy="save-template-title"
    >
      {success ? (
        <div className="p-5">
          <div className="flex flex-col items-center py-8">
            <div className="w-16 h-16 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mb-4">
              <svg className="w-8 h-8 text-green-600 dark:text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <p className="text-lg font-medium text-gray-900 dark:text-gray-100">Template Saved!</p>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              You can find it in Templates page
            </p>
          </div>
        </div>
      ) : (
        <form id="save-template-form" onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <label htmlFor="templateName" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Template name
            </label>
            <input
              id="templateName"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Weekly Groceries Template"
              className="w-full px-4 py-3 bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100 border-2 border-gray-200 dark:border-gray-700 rounded-xl focus:outline-none focus:border-amber-500 dark:focus:border-amber-500 focus:ring-4 focus:ring-amber-500/10 transition-all disabled:opacity-50"
              disabled={isSaving}
              autoFocus
            />
          </div>

          <div>
            <label htmlFor="templateDescription" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Description (optional)
            </label>
            <textarea
              id="templateDescription"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What is this template for?"
              rows={2}
              className="w-full px-4 py-3 bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100 border-2 border-gray-200 dark:border-gray-700 rounded-xl focus:outline-none focus:border-amber-500 dark:focus:border-amber-500 focus:ring-4 focus:ring-amber-500/10 transition-all disabled:opacity-50 resize-none"
              disabled={isSaving}
            />
          </div>

          <div>
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={isPublic}
                onChange={(e) => setIsPublic(e.target.checked)}
                disabled={isSaving}
                className="w-5 h-5 rounded border-gray-300 dark:border-gray-600 text-amber-500 focus:ring-amber-500 dark:bg-gray-700"
              />
              <span className="text-sm text-gray-700 dark:text-gray-300">
                Make public (others can use this template)
              </span>
            </label>
          </div>

          <p className="text-xs text-gray-500 dark:text-gray-400">
            Only unchecked items will be included in the template.
          </p>

          {error && (
            <div className="px-4 py-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl text-red-700 dark:text-red-400 text-sm flex items-center gap-2">
              <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {error}
            </div>
          )}
        </form>
      )}
    </Panel>
  );
}

export default SaveAsTemplateModal;
