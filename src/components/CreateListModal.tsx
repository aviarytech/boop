/**
 * Panel for creating a new list.
 * Uses Panel component for slide-up drawer experience.
 * Features improved design and dark mode support.
 */

import { useState, type FormEvent } from "react";
import { useMutation, useQuery } from "convex/react";
import { useNavigate, Link } from "react-router-dom";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { useCurrentUser } from "../hooks/useCurrentUser";
import { useSettings } from "../hooks/useSettings";
import { createListAsset } from "../lib/originals";
import { isPlanLimitError } from "../lib/planLimit";
import { CategorySelector } from "./lists/CategorySelector";
import { Panel } from "./ui/Panel";
import { trackListCreated, trackFirstListCreated, trackFeatureGateHit, trackInviteSent } from "../lib/analytics";
import { ReferralInviteCurrentUser } from "./ReferralInvite";

interface CreateListModalProps {
  onClose: () => void;
  onListCreated?: (listId: Id<"lists">, listName: string) => void;
}

export function CreateListModal({ onClose, onListCreated }: CreateListModalProps) {
  const { did } = useCurrentUser();
  const navigate = useNavigate();
  const { haptic } = useSettings();
  const createList = useMutation(api.lists.createList);
  const existingLists = useQuery(api.lists.getUserLists, did ? { userDid: did } : "skip");

  const [name, setName] = useState("");
  const [categoryId, setCategoryId] = useState<Id<"categories"> | undefined>(undefined);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [planLimitHit, setPlanLimitHit] = useState(false);
  const [createdListId, setCreatedListId] = useState<Id<"lists"> | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();

    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("Please enter a list name");
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
      const listAsset = await createListAsset(trimmedName, did);

      const listId = await createList({
        assetDid: listAsset.assetDid,
        celEnvelope: listAsset.envelope,
        name: trimmedName,
        ownerDid: did,
        categoryId,
        createdAt: Date.now(),
      });

      haptic('success');
      const newCount = (existingLists?.length ?? 0) + 1;
      trackListCreated(newCount);
      if (newCount === 1) trackFirstListCreated();
      setCreatedListId(listId);
      setIsCreating(false);
      onListCreated?.(listId, trimmedName);
    } catch (err) {
      console.error("Failed to create list:", err);
      if (isPlanLimitError(err)) {
        setPlanLimitHit(true);
        trackFeatureGateHit("list_limit", "free");
      } else {
        setError("Failed to create list. Please try again.");
      }
      haptic('error');
      setIsCreating(false);
    }
  };

  const handleGoToList = () => {
    if (createdListId) navigate(`/list/${createdListId}`);
  };

  const handleShareList = () => {
    if (!createdListId) return;
    trackInviteSent('native_share');
    navigate(`/list/${createdListId}`, { state: { openShare: true } });
  };

  const header = (
    <>
      <div className="flex items-center gap-3">
        <span className="text-2xl leading-none">{createdListId ? "🎉" : "✨"}</span>
        <div>
          <h2 id="create-list-dialog-title" className="text-lg font-bold text-gray-900 dark:text-gray-100">
            {createdListId ? "List created!" : "Create New List"}
          </h2>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {createdListId ? name : "Give your list a name"}
          </p>
        </div>
      </div>
      <button
        onClick={() => {
          haptic('light');
          if (createdListId) handleGoToList();
          else onClose();
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

  const footer = createdListId ? (
    <div className="px-5 py-4 flex gap-3">
      <button
        type="button"
        onClick={() => { haptic('light'); handleGoToList(); }}
        className="flex-1 px-4 py-3 text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded-xl font-medium hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
      >
        Go to list
      </button>
      <button
        type="button"
        onClick={() => { haptic('medium'); handleShareList(); }}
        className="flex-1 px-4 py-3 bg-amber-500 hover:bg-amber-400 text-white rounded-xl font-semibold shadow-lg shadow-amber-500/25 transition-all"
      >
        Share list
      </button>
    </div>
  ) : (
    <div className="px-5 py-4 flex gap-3">
      <button
        type="button"
        onClick={() => {
          haptic('light');
          onClose();
        }}
        disabled={isCreating}
        className="flex-1 px-4 py-3 text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded-xl font-medium hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50 transition-colors"
      >
        Cancel
      </button>
      <button
        type="submit"
        form="create-list-form"
        disabled={isCreating || !name.trim()}
        className="flex-1 px-4 py-3 bg-amber-500 hover:bg-amber-400 text-white rounded-xl font-semibold shadow-lg shadow-amber-500/25 disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none transition-all"
      >
        {isCreating ? (
          <span className="flex items-center justify-center gap-2">
            <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            Creating...
          </span>
        ) : (
          "Create List"
        )}
      </button>
    </div>
  );

  return (
    <Panel
      isOpen={true}
      onClose={createdListId ? handleGoToList : onClose}
      header={header}
      footer={footer}
      ariaLabelledBy="create-list-dialog-title"
    >
      {createdListId ? (
        <div className="p-5 space-y-4">
          <div className="p-4 bg-green-50 dark:bg-green-900/20 rounded-xl">
            <div className="flex items-center gap-2 text-green-800 dark:text-green-400 font-medium mb-1">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <span>"{name}" is ready</span>
            </div>
            <p className="text-sm text-green-700 dark:text-green-500">
              Invite a collaborator to join the list and get things done together.
            </p>
          </div>
        </div>
      ) : (
      /* Form */
      <form id="create-list-form" onSubmit={handleSubmit} className="p-5 space-y-4">
        <div>
          <label htmlFor="listName" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            List name
          </label>
          <input
            id="listName"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g., Groceries, Weekend Tasks"
            className="w-full px-4 py-3 bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100 border-2 border-gray-200 dark:border-gray-700 rounded-xl focus:outline-none focus:border-amber-500 dark:focus:border-amber-500 focus:ring-4 focus:ring-amber-500/10 transition-all disabled:opacity-50"
            disabled={isCreating}
            autoFocus
          />
        </div>

        <CategorySelector
          value={categoryId}
          onChange={setCategoryId}
          disabled={isCreating}
        />

        {error && (
          <div className="px-4 py-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl text-red-700 dark:text-red-400 text-sm flex items-center gap-2">
            <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            {error}
          </div>
        )}

        {planLimitHit && (
          <div className="px-4 py-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl text-amber-800 dark:text-amber-300 text-sm space-y-4">
            <div className="flex items-center gap-2 font-semibold">
              <span>🚀</span>
              <span>You've reached the free plan limit of 5 lists</span>
            </div>

            {/* Referral CTA */}
            <div className="p-3 bg-white dark:bg-gray-800 rounded-lg border border-amber-200 dark:border-amber-700">
              <ReferralInviteCurrentUser compact />
            </div>

            <div className="flex items-center gap-2 text-xs text-amber-600 dark:text-amber-500">
              <span className="flex-1 border-t border-amber-200 dark:border-amber-700" />
              <span>or upgrade for unlimited</span>
              <span className="flex-1 border-t border-amber-200 dark:border-amber-700" />
            </div>

            <Link
              to="/pricing"
              onClick={onClose}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-amber-500 hover:bg-amber-400 text-white rounded-lg font-semibold text-sm transition-colors"
            >
              View pricing →
            </Link>
          </div>
        )}
      </form>
      )}
    </Panel>
  );
}
