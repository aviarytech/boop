/**
 * Keyboard shortcuts hook for power users.
 * Provides hotkeys for common actions.
 */

import { useEffect, useCallback, useState } from "react";

export interface Shortcut {
  key: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  meta?: boolean;
  description: string;
  action: () => void;
}

export interface UseKeyboardShortcutsOptions {
  enabled?: boolean;
  shortcuts: Shortcut[];
}

export function useKeyboardShortcuts({
  enabled = true,
  shortcuts,
}: UseKeyboardShortcutsOptions) {
  const [showHelp, setShowHelp] = useState(false);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!enabled) return;

      // Don't trigger shortcuts when typing in inputs
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      ) {
        // Allow Escape to blur inputs
        if (e.key === "Escape") {
          target.blur();
        }
        return;
      }

      // Show help with ?
      if (e.key === "?" && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        setShowHelp((prev) => !prev);
        return;
      }

      // Check if any shortcut matches
      for (const shortcut of shortcuts) {
        const keyMatch = e.key.toLowerCase() === shortcut.key.toLowerCase();
        const ctrlMatch = !!shortcut.ctrl === (e.ctrlKey || e.metaKey);
        const shiftMatch = !!shortcut.shift === e.shiftKey;
        const altMatch = !!shortcut.alt === e.altKey;

        if (keyMatch && ctrlMatch && shiftMatch && altMatch) {
          e.preventDefault();
          shortcut.action();
          return;
        }
      }
    },
    [enabled, shortcuts]
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  return {
    showHelp,
    setShowHelp,
  };
}

/**
 * Format a shortcut for display.
 */
export function formatShortcut(shortcut: Shortcut): string {
  const parts: string[] = [];
  
  if (shortcut.ctrl) parts.push("⌘/Ctrl");
  if (shortcut.shift) parts.push("⇧");
  if (shortcut.alt) parts.push("⌥/Alt");
  
  // Format the key nicely
  let key = shortcut.key;
  if (key === " ") key = "Space";
  else if (key === "ArrowUp") key = "↑";
  else if (key === "ArrowDown") key = "↓";
  else if (key === "ArrowLeft") key = "←";
  else if (key === "ArrowRight") key = "→";
  else if (key === "Escape") key = "Esc";
  else if (key === "Enter") key = "↵";
  else key = key.toUpperCase();
  
  parts.push(key);
  
  return parts.join(" + ");
}

/**
 * Keyboard shortcuts help modal.
 */
interface KeyboardShortcutsHelpProps {
  shortcuts: Shortcut[];
  onClose: () => void;
}

export function KeyboardShortcutsHelp({ shortcuts, onClose }: KeyboardShortcutsHelpProps) {
  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-md animate-slide-up overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
            <span>⌨️</span> Keyboard Shortcuts
          </h2>
          <button
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 rounded-lg transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-5 space-y-2 max-h-96 overflow-y-auto">
          <div className="flex justify-between items-center py-2 text-sm">
            <span className="text-gray-600 dark:text-gray-400">Show this help</span>
            <kbd className="px-2 py-1 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded text-xs font-mono">
              ?
            </kbd>
          </div>
          
          {shortcuts.map((shortcut, i) => (
            <div
              key={i}
              className="flex justify-between items-center py-2 text-sm border-t border-gray-100 dark:border-gray-700"
            >
              <span className="text-gray-600 dark:text-gray-400">{shortcut.description}</span>
              <kbd className="px-2 py-1 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded text-xs font-mono">
                {formatShortcut(shortcut)}
              </kbd>
            </div>
          ))}
        </div>

        <div className="px-5 py-3 bg-gray-50 dark:bg-gray-900 text-xs text-gray-500 dark:text-gray-400 text-center">
          Press <kbd className="px-1 py-0.5 bg-gray-200 dark:bg-gray-700 rounded">Esc</kbd> to close
        </div>
      </div>
    </div>
  );
}
