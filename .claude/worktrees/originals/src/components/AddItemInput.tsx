/**
 * Input component for adding new items to a list.
 * Features improved design, dark mode, and haptic feedback.
 */

import { useState, useRef, type FormEvent, forwardRef, useImperativeHandle } from "react";
import { useCurrentUser } from "../hooks/useCurrentUser";
import { useSettings } from "../hooks/useSettings";

interface AddItemInputProps {
  assetDid: string;
  onAddItem: (args: {
    name: string;
    createdByDid: string;
    legacyDid?: string;
    createdAt: number;
  }) => Promise<void>;
}

export const AddItemInput = forwardRef<HTMLInputElement, AddItemInputProps>(function AddItemInput({ onAddItem }, ref) {
  const { did, legacyDid } = useCurrentUser();
  const { haptic } = useSettings();
  const inputRef = useRef<HTMLInputElement>(null);
  
  // Expose the input ref to parent components
  useImperativeHandle(ref, () => inputRef.current as HTMLInputElement);

  const [name, setName] = useState("");
  const [isAdding, setIsAdding] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();

    const trimmedName = name.trim();
    if (!trimmedName || !did || isAdding) {
      return;
    }

    haptic('medium');
    setIsAdding(true);
    setName("");

    // Keep focus on the input immediately — don't wait for async.
    // Clear the value first so the user sees it's ready for the next item.
    inputRef.current?.focus();

    try {
      await onAddItem({
        name: trimmedName,
        createdByDid: did,
        legacyDid: legacyDid ?? undefined,
        createdAt: Date.now(),
      });
      haptic('success');
    } catch (err) {
      console.error("Failed to add item:", err);
      haptic('error');
      // Restore the text on error so the user doesn't lose it
      setName(trimmedName);
    } finally {
      setIsAdding(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex gap-3" aria-label="Add new item">
      <div className="flex-1 relative">
        <label htmlFor="add-item-input" className="sr-only">Add new item</label>
        <input
          ref={inputRef}
          id="add-item-input"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Add item..."
          className="w-full px-4 py-3.5 bg-white dark:bg-gray-800 border-2 border-gray-200 dark:border-gray-700 rounded-xl text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:border-amber-500 dark:focus:border-amber-500 focus:ring-4 focus:ring-amber-500/10 transition-all disabled:opacity-50"
        />
        
{/* Removed "Press Enter" hint per user feedback */}
      </div>
      
      <button
        type="submit"
        disabled={isAdding || !name.trim()}
        className="px-6 py-3.5 bg-amber-500 hover:bg-amber-400 text-white rounded-xl font-semibold shadow-lg shadow-amber-500/25 hover:shadow-xl hover:shadow-amber-500/30 focus:outline-none focus:ring-4 focus:ring-amber-500/30 disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none transition-all active:scale-95"
      >
        {isAdding ? (
          <span className="flex items-center gap-2">
            <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
          </span>
        ) : (
          <span className="flex items-center gap-2">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Add
          </span>
        )}
      </button>
    </form>
  );
});
