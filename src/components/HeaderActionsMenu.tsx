/**
 * HeaderActionsMenu - A dropdown menu for list header actions.
 * Consolidates action buttons (Share, Publish, Template, Delete, Keyboard shortcuts)
 * into a single menu to reduce header crowding, especially on mobile.
 */

import { useState, useRef, useEffect } from "react";
import { Icon, type IconName } from "./ui/Icon";

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
  /** Omitted where the page has no shortcuts, which hides the item. */
  onKeyboardShortcuts?: () => void;
  haptic: (type: 'light' | 'medium' | 'heavy') => void;
  /** The noun in "Rename …" / "Delete …". */
  subject?: "list" | "note";
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
  subject = "list",
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
        className={TOOLBAR_BUTTON}
        aria-label="More actions"
        aria-expanded={isOpen}
        aria-haspopup="true"
      >
        <svg className="w-[18px] h-[18px]" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="5" r="1.75" /><circle cx="12" cy="12" r="1.75" /><circle cx="12" cy="19" r="1.75" />
        </svg>
      </button>

      {isOpen && (
        <div
          ref={menuRef}
          className="absolute right-0 top-full mt-2 w-56 bg-[var(--boop-card)] rounded-xl shadow-lg border border-[var(--boop-line)] py-1.5 z-50 animate-slide-up"
        >
          {onKeyboardShortcuts && (
            <MenuItem icon="keyboard" label="Keyboard shortcuts" hint="?" onClick={() => handleAction(onKeyboardShortcuts)} />
          )}
          {canRename && (
            <MenuItem icon="pencil" label={`Rename ${subject}`} onClick={() => handleAction(onRename)} />
          )}
          {canChangeCategory && onChangeCategory && (
            <MenuItem icon="folder" label="Change category" disabled={!isOnline} onClick={() => handleAction(onChangeCategory)} />
          )}

          {(canShare || onNativeShare || canPublish || canSaveTemplate) && <Divider />}

          {canShare && (
            <MenuItem icon="users" label="Share with people" onClick={() => handleAction(onShare)} />
          )}
          {onNativeShare && (
            <MenuItem icon="link" label="Send public read link" onClick={() => handleAction(onNativeShare)} />
          )}
          {canPublish && (
            <MenuItem icon="globe" label={isPublished ? "Manage publication" : "Publish publicly"} disabled={!isOnline} onClick={() => handleAction(onPublish)} />
          )}
          {canSaveTemplate && (
            <MenuItem icon="copy" label="Save as template" disabled={!isOnline} onClick={() => handleAction(onSaveTemplate)} />
          )}

          {canDelete && (
            <>
              <Divider />
              <MenuItem icon="trash" label={`Delete ${subject}`} danger disabled={!isOnline} onClick={() => handleAction(onDelete)} />
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** Shared treatment for the round icon buttons in a list or note header. */
export const TOOLBAR_BUTTON =
  "inline-flex items-center justify-center w-9 h-9 rounded-full bg-[var(--boop-panel)] text-[var(--boop-muted)] hover:text-[var(--boop-ink)] transition-colors active:scale-95 disabled:opacity-50";

function Divider() {
  return <div className="border-t border-[var(--boop-line)] my-1.5" />;
}

function MenuItem({ icon, label, hint, danger, disabled, onClick }: {
  icon: IconName;
  label: string;
  hint?: string;
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  const tone = disabled
    ? "text-[var(--boop-dim)] cursor-not-allowed"
    : danger
      ? "text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20"
      : "text-[var(--boop-ink)] hover:bg-[var(--boop-panel)]";
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`w-full px-4 py-2.5 text-left text-sm flex items-center gap-3 transition-colors ${tone}`}
    >
      <Icon name={icon} className={`w-[18px] h-[18px] ${danger || disabled ? "" : "text-[var(--boop-muted)]"}`} />
      <span>{label}</span>
      {disabled ? (
        <span className="ml-auto text-xs">Offline</span>
      ) : hint ? (
        <span className="ml-auto text-xs text-[var(--boop-dim)]">{hint}</span>
      ) : null}
    </button>
  );
}
