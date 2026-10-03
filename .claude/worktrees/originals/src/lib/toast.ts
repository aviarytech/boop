/**
 * Global toast utilities for non-React access (Phase 5.8)
 *
 * Provides a singleton pattern to show toasts from outside React components
 * (e.g., from the SyncManager).
 */

export type ToastType = "info" | "warning" | "error";

// Singleton reference to the toast function
let globalAddToast: ((message: string, type?: ToastType) => void) | null = null;

/**
 * Register the global toast function.
 * Called by ToastProvider to enable toast access from outside React.
 */
export function registerGlobalToast(
  addToast: (message: string, type?: ToastType) => void
): void {
  globalAddToast = addToast;
}

/**
 * Unregister the global toast function.
 * Called when ToastProvider unmounts.
 */
export function unregisterGlobalToast(): void {
  globalAddToast = null;
}

/**
 * Show a toast from outside React components (e.g., SyncManager).
 * Returns false if toast system is not mounted.
 */
export function showGlobalToast(message: string, type: ToastType = "info"): boolean {
  if (globalAddToast) {
    globalAddToast(message, type);
    return true;
  }
  return false;
}
