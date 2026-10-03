/**
 * HeaderActionsMenu - A dropdown menu for list header actions.
 * Consolidates action buttons (Share, Publish, Template, Delete, Keyboard shortcuts)
 * into a single menu to reduce header crowding, especially on mobile.
 */

import { useState, useRef, useEffect } from "react";

interface HeaderActionsMenuProps {
  canShare: boolean;
  canPublish: boolean;
  canSaveTemplate: boolean;
  canDelete: boolean;
  canRename: boolean;
  canChangeCategory?: boolean;
  isOnline: boolean;
  isPublished: boolean;
  onShare: () => void;
  onNativeShare?: () => void;
  onPublish: () => void;
  onSaveTemplate: () => void;
  onDelete: () => void;
  onRename: () => void;
  onChangeCategory?: () => void;
  onKeyboardShortcuts: () => void;
  haptic: (type: 'light' | 'medium' | 'heavy') => void;
}

export function HeaderActionsMenu({
  canShare,
  canPublish,
  canSaveTemplate,
  canDelete,
  canRename,
  canChangeCategory,
  isOnline,
  isPublished,
  onShare,
  onNativeShare,
  onPublish,
  onSaveTemplate,
  onDelete,
  onRename,
  onChangeCategory,
  onKeyboardShortcuts,
  haptic,
}: HeaderActionsMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Close menu when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        menuRef.current &&
        !menuRef.current.contains(event.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [isOpen]);

  // Close menu on escape key
  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener("keydown", handleEscape);
      return () => document.removeEventListener("keydown", handleEscape);
    }
  }, [isOpen]);

  const handleAction = (action: () => void) => {
    haptic('light');
    action();
    setIsOpen(false);
  };

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        onClick={() => {
          haptic('light');
          setIsOpen(!isOpen);
        }}
        className="inline-flex items-center justify-center p-2 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-all active:scale-95"
        aria-label="More actions"
        aria-expanded={isOpen}
        aria-haspopup="true"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
        </svg>
      </button>

      {isOpen && (
        <div
          ref={menuRef}
          className="absolute right-0 top-full mt-2 w-56 bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 py-2 z-50 animate-slide-up"
        >
          {/* Keyboard shortcuts - hidden on mobile via CSS, visible in dropdown on desktop */}
          <button
            onClick={() => handleAction(onKeyboardShortcuts)}
            className="w-full px-4 py-2.5 text-left text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-3 transition-colors"
          >
            <span className="text-base leading-none">⌨️</span>
            <span>Keyboard shortcuts</span>
            <span className="ml-auto text-xs text-gray-400 dark:text-gray-500">?</span>
          </button>

          {/* Rename */}
          {canRename && (
            <button
              onClick={() => handleAction(onRename)}
              className="w-full px-4 py-2.5 text-left text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-3 transition-colors"
            >
              <span className="text-base leading-none">✏️</span>
              <span>Rename list</span>
            </button>
          )}

          {/* Change category */}
          {canChangeCategory && onChangeCategory && (
            <button
              onClick={() => handleAction(onChangeCategory)}
              disabled={!isOnline}
              className={`w-full px-4 py-2.5 text-left text-sm flex items-center gap-3 transition-colors ${
                !isOnline 
                  ? "text-gray-400 dark:text-gray-500 cursor-not-allowed" 
                  : "text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
              }`}
            >
              <span className="text-base leading-none">📁</span>
              <span>Change category</span>
              {!isOnline && <span className="ml-auto text-xs text-gray-400">Offline</span>}
            </button>
          )}

          <div className="border-t border-gray-100 dark:border-gray-700 my-1" />

          {/* Share */}
          {canShare && (
            <button
              onClick={() => handleAction(onShare)}
              className="w-full px-4 py-2.5 text-left text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-3 transition-colors"
            >
              <span className="text-base leading-none">🔗</span>
              <span>Share link</span>
            </button>
          )}

          {/* Native Share */}
          {onNativeShare && (
            <button
              onClick={() => handleAction(onNativeShare)}
              className="w-full px-4 py-2.5 text-left text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-3 transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
              </svg>
              <span>Share...</span>
            </button>
          )}

          {/* Publish */}
          {canPublish && (
            <button
              onClick={() => handleAction(onPublish)}
              disabled={!isOnline}
              className={`w-full px-4 py-2.5 text-left text-sm flex items-center gap-3 transition-colors ${
                !isOnline 
                  ? "text-gray-400 dark:text-gray-500 cursor-not-allowed" 
                  : "text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
              }`}
            >
              <span className="text-base leading-none">📡</span>
              <span>{isPublished ? "Manage publication" : "Publish list"}</span>
              {!isOnline && <span className="ml-auto text-xs text-gray-400">Offline</span>}
            </button>
          )}

          {/* Save as template */}
          {canSaveTemplate && (
            <button
              onClick={() => handleAction(onSaveTemplate)}
              disabled={!isOnline}
              className={`w-full px-4 py-2.5 text-left text-sm flex items-center gap-3 transition-colors ${
                !isOnline 
                  ? "text-gray-400 dark:text-gray-500 cursor-not-allowed" 
                  : "text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
              }`}
            >
              <svg className="w-5 h-5 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7v8a2 2 0 002 2h6M8 7V5a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V15a2 2 0 01-2 2h-2M8 7H6a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2v-2" />
              </svg>
              <span>Save as template</span>
              {!isOnline && <span className="ml-auto text-xs text-gray-400">Offline</span>}
            </button>
          )}

          {/* Delete - only show if user can delete */}
          {canDelete && (
            <>
              <div className="border-t border-gray-100 dark:border-gray-700 my-1" />
              <button
                onClick={() => handleAction(onDelete)}
                disabled={!isOnline}
                className={`w-full px-4 py-2.5 text-left text-sm flex items-center gap-3 transition-colors ${
                  !isOnline 
                    ? "text-gray-400 dark:text-gray-500 cursor-not-allowed" 
                    : "text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20"
                }`}
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
                <span>Delete list</span>
                {!isOnline && <span className="ml-auto text-xs text-gray-400">Offline</span>}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
