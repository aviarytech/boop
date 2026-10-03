/**
 * Reusable confirmation dialog component.
 *
 * Provides accessible modal for confirm/cancel actions.
 * Uses alertdialog role for destructive confirmations.
 */

import { useState } from "react";
import { useFocusTrap } from "../hooks/useFocusTrap";

interface ConfirmDialogProps {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  confirmVariant?: "danger" | "primary";
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  confirmVariant = "danger",
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const [isConfirming, setIsConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useFocusTrap<HTMLDivElement>({ onEscape: onCancel });

  const handleConfirm = async () => {
    setIsConfirming(true);
    setError(null);

    try {
      await onConfirm();
    } catch (err) {
      console.error("Confirm action failed:", err);
      setError(err instanceof Error ? err.message : "Action failed. Please try again.");
      setIsConfirming(false);
    }
  };

  const confirmButtonClasses =
    confirmVariant === "danger"
      ? "bg-red-600 text-white hover:bg-red-700"
      : "bg-amber-600 text-white hover:bg-amber-500 transition-all";

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-description"
        className="bg-white rounded-lg shadow-xl max-w-md w-full p-6"
      >
        <h2 id="confirm-dialog-title" className="text-xl font-bold text-gray-900 mb-2">
          {title}
        </h2>
        <p id="confirm-dialog-description" className="text-gray-600 mb-4">
          {message}
        </p>

        {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

        <div className="flex gap-3 justify-end">
          <button
            type="button"
            onClick={onCancel}
            disabled={isConfirming}
            className="px-4 py-2 text-gray-700 bg-gray-100 rounded-md font-medium hover:bg-gray-200 disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={isConfirming}
            className={`px-4 py-2 rounded-md font-medium disabled:opacity-50 ${confirmButtonClasses}`}
          >
            {isConfirming ? "..." : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
