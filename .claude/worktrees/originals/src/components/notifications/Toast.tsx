/**
 * Toast notification component (Phase 5.8)
 *
 * Displays temporary toast notifications in the bottom-right corner.
 * Supports info, warning, and error types with appropriate styling.
 */

import { useEffect } from "react";
import { useToast, type Toast as ToastType } from "../../hooks/useToast";
import { registerGlobalToast, unregisterGlobalToast } from "../../lib/toast";

// ============================================================================
// Single Toast Component
// ============================================================================

interface ToastItemProps {
  toast: ToastType;
  onDismiss: (id: string) => void;
}

function ToastItem({ toast, onDismiss }: ToastItemProps) {
  const bgColor = {
    info: "bg-blue-100 text-blue-800 border-blue-200",
    warning: "bg-amber-100 text-amber-800 border-amber-200",
    error: "bg-red-100 text-red-800 border-red-200",
  }[toast.type];

  return (
    <div
      role="alert"
      aria-live="polite"
      className={`rounded-lg border px-4 py-3 shadow-lg ${bgColor} flex items-start gap-3 max-w-sm`}
    >
      <span className="flex-1 text-sm">{toast.message}</span>
      <button
        onClick={() => onDismiss(toast.id)}
        className="text-current opacity-60 hover:opacity-100 transition-opacity"
        aria-label="Dismiss"
      >
        <svg
          className="h-4 w-4"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
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
  );
}

// ============================================================================
// Toast Container Component
// ============================================================================

/**
 * Container component that renders all active toasts.
 * Place this once in your app (e.g., in App.tsx).
 *
 * Also registers the global toast function for non-React access.
 *
 * @example
 * ```tsx
 * function App() {
 *   return (
 *     <ToastProvider>
 *       <Router>
 *         ...
 *       </Router>
 *       <ToastContainer />
 *     </ToastProvider>
 *   );
 * }
 * ```
 */
export function ToastContainer() {
  const { toasts, removeToast, addToast } = useToast();

  // Register global toast function for SyncManager access
  useEffect(() => {
    registerGlobalToast(addToast);
    return () => {
      unregisterGlobalToast();
    };
  }, [addToast]);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={removeToast} />
      ))}
    </div>
  );
}
