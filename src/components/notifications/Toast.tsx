/**
 * Toast notification component (Phase 5.8)
 *
 * Displays temporary toast notifications in the bottom-right corner.
 * Supports info, warning, and error types with appropriate styling.
 */

import { useEffect } from "react";
import { useToast, type Toast as ToastType } from "../../hooks/useToast";
import { registerGlobalToast, unregisterGlobalToast } from "../../lib/toast";
import { Icon } from "../ui/Icon";

// ============================================================================
// Single Toast Component
// ============================================================================

interface ToastItemProps {
  toast: ToastType;
  onDismiss: (id: string) => void;
}

function ToastItem({ toast, onDismiss }: ToastItemProps) {
  const tone = {
    info: { box: "bg-[var(--boop-card)] text-[var(--boop-ink)] border-[var(--boop-line)]", icon: "info" as const, iconColor: "text-[var(--boop-accent)]" },
    warning: { box: "bg-[var(--boop-card)] text-[var(--boop-ink)] border-[oklch(75%_0.13_75/0.6)]", icon: "alert" as const, iconColor: "text-[oklch(58%_0.14_65)] dark:text-[oklch(80%_0.13_75)]" },
    error: { box: "bg-red-50 text-red-800 border-red-200 dark:bg-red-950 dark:text-red-200 dark:border-red-800", icon: "alert" as const, iconColor: "text-current" },
  }[toast.type];

  return (
    <div
      role="alert"
      aria-live="polite"
      className={`rounded-xl border px-4 py-3 shadow-lg ${tone.box} flex items-start gap-3 max-w-sm`}
    >
      <Icon name={tone.icon} className={`w-[18px] h-[18px] mt-px ${tone.iconColor}`} />
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
