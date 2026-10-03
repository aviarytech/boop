/**
 * Toast notification system hook (Phase 5.8)
 *
 * Provides a simple toast system for showing temporary notifications.
 * Uses React Context to allow toasts from anywhere in the app.
 */

/* eslint-disable react-refresh/only-export-components */
import {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
  type ReactNode,
} from "react";

// ============================================================================
// Types
// ============================================================================

export type ToastType = "info" | "warning" | "error";

export interface Toast {
  id: string;
  message: string;
  type: ToastType;
}

interface ToastContextValue {
  toasts: Toast[];
  addToast: (message: string, type?: ToastType) => void;
  removeToast: (id: string) => void;
}

// ============================================================================
// Context
// ============================================================================

const ToastContext = createContext<ToastContextValue | null>(null);

// Auto-dismiss duration in milliseconds
const TOAST_DURATION = 5000;

// ============================================================================
// Provider
// ============================================================================

interface ToastProviderProps {
  children: ReactNode;
}

/**
 * Provider component for the toast system.
 * Wrap your app with this to enable toast notifications.
 *
 * @example
 * ```tsx
 * <ToastProvider>
 *   <App />
 * </ToastProvider>
 * ```
 */
export function ToastProvider({ children }: ToastProviderProps) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  // Track timeout IDs to clear them when toast is removed early
  const timeoutRefs = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const removeToast = useCallback((id: string) => {
    // Clear the auto-dismiss timeout if toast is removed early
    const timeoutId = timeoutRefs.current.get(id);
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutRefs.current.delete(id);
    }
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const addToast = useCallback(
    (message: string, type: ToastType = "info") => {
      const id = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      setToasts((prev) => [...prev, { id, message, type }]);

      // Auto-dismiss after TOAST_DURATION
      const timeoutId = setTimeout(() => {
        timeoutRefs.current.delete(id);
        removeToast(id);
      }, TOAST_DURATION);
      timeoutRefs.current.set(id, timeoutId);
    },
    [removeToast]
  );

  return (
    <ToastContext.Provider value={{ toasts, addToast, removeToast }}>
      {children}
    </ToastContext.Provider>
  );
}

// ============================================================================
// Hook
// ============================================================================

/**
 * Hook to access the toast system.
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const { addToast } = useToast();
 *
 *   const handleClick = () => {
 *     addToast('Item was updated by another user', 'warning');
 *   };
 *
 *   return <button onClick={handleClick}>Show Toast</button>;
 * }
 * ```
 */
export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return context;
}
